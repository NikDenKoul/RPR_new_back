
const mysql = require("mysql2");

const db = mysql.createPool({
    connectionLimit: 15,
    host: "localhost",
    user: "db_user",
    database: "u0860595_rp_ruler",
    password: "bB2ETA5wgR5ZjfQc"
});
const dbP = db.promise();

const ValidatingFunctions = require('./ValidatingFunctions');
const fs = require("fs");

module.exports = {

    /** ========== Взаимодействие с аттрибутами персонажей на сервере ========== */

    /**
     * Обновить набор аттрибутов
     * @param body.serverId - id сервера, на котором проводятся изменения
     * @param body.attributes - добавляемые и обновляемые аттрибуты
     * @param body.deletedIds - id'шники удаляемых аттрибутов
     */
    editAttributes : async function(req, res) {
        // Парсинг массива аттрибутов
        let attributes = JSON.parse(req.body.attributes);
        let deletedIds = JSON.parse(req.body.deletedIds);
        let serverId = req.body.serverId;

        // Проверка прав доступа для редактирования набора аттрибутов
        let permission = await ValidatingFunctions.checkRights("server_edit",req.userId,serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }

        // Изменение набора аттрибутов на сервере
        attributes.forEach((attribute, order) => {
                // Добавление нового аттрибута (т. к. id'шник был нулевой, присваивается новый)
                if (attribute.id <= 0) {
                    dbP.execute("INSERT INTO attribute VALUES (NULL, ?, ?, ?, ?);",
                        [serverId, attribute.name, attribute.type, attribute.isGeneral]);
                }
                // Обновление существующего аттрибута
                else {
                    dbP.execute("UPDATE attribute SET server_id=?, name=?, type=?, isGeneral=? WHERE id=?;",
                        [serverId, attribute.name, attribute.type, attribute.isGeneral, attribute.id]);
                }
            }
        )

        // Удаление аттрибутов
        deletedIds.forEach((attribute_id) => {
            dbP.execute("DELETE FROM attribute WHERE id=?",[attribute_id]);
        })

        res.send({success:1});
    },

    getProfileAttributes : async function(req,res) {
        let [data] = await dbP.execute("SELECT `attribute`.* FROM attribute WHERE attribute.server_id = ? AND  isGeneral = 1;",
            [req.query.serverId]);
        res.send({data:data});
    },

    getAttributes : async function(req,res) {
        let [data] = await dbP.execute("SELECT `attribute`.* FROM attribute WHERE attribute.server_id = ?",
            [req.query.serverId]);
        res.send({data:data});
    },

    /** ========== Взаимодействие с системой опыта ========== */

    /**
     * Обновить набор аттрибутов
     * @param body.serverId - id сервера, на котором проводятся изменения
     * @param body.levels - добавляемые и обновляемые уровни
     * @param body.deletedIds - id'шники удаляемых аттрибутов
     */
    editLevels : async function(req,res){
        let levels = JSON.parse(req.body.levels);
        let deletedIds = JSON.parse(req.body.deletedIds);
        let serverId = req.body.serverId;

        // Проверка прав доступа для редактирования набора аттрибутов
        let permission = await ValidatingFunctions.checkRights("server_edit",req.userId,serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }

        // Получаем аттрибуты на сервере
        let [attributes] = await dbP.execute("SELECT `id`, `name` FROM attribute WHERE server_id=? AND isGeneral=FALSE",[serverId]);

        // Изменение набора уровней на сервере
        levels.forEach((level, order) => {
                // Добавление нового уровня (т. к. id'шник был нулевой, присваивается новый)
                if (level.id <= 0) {
                    db.query("INSERT INTO level VALUES (NULL, ?, ?, ?);",[level.num, level.required_exp, serverId],async function(err,data){
                        let lvl_id = data.insertId
                        attributes.forEach((attribute) => {
                            dbP.execute("INSERT INTO levels_attributes VALUES (NULL,?,?,?);",[lvl_id,attribute.id,level[attribute.name]]);
                        })
                    });
                }
                // Обновление существующего уровня
                else {
                    dbP.execute("UPDATE level SET num=?, required_exp=?, server_id=? WHERE id=?;",
                        [level.num, level.required_exp, serverId, level.id]);
                    attributes.forEach((attribute) => {
                        dbP.execute("UPDATE levels_attributes SET value=? WHERE lvl_id=? AND attribute_id=?;",[level[attribute.name],level.id,attribute.id]);
                    })
                }
            }
        )

        // Удаление аттрибутов
        deletedIds.forEach((lvl_id) => {
            dbP.execute("DELETE FROM level WHERE id=?",[lvl_id]);
        })

        res.send({success:1});
    },

    /**
      * Получить значения всех аттрибутов по уровням
      */
    getLevels : async function(req,res) {
        let [levels] = await dbP.execute("SELECT * FROM `level` WHERE server_id=?;",[req.query.serverId]);

        let [levels_attributes] = await dbP.execute("SELECT `levels_attributes`.id, lvl_id, `level`.num, attribute.`name`, `value` FROM `levels_attributes` " +
            "LEFT JOIN `level` ON lvl_id=`level`.id " +
            "LEFT JOIN attribute ON attribute_id=attribute.id " +
            "WHERE `level`.server_id = ? " +
            "ORDER BY `level`.num;",
            [req.query.serverId]);

        res.send({levels:levels, levels_attributes:levels_attributes});
    },

    /** ========== Взаимодействие с игровыми персонажами ========== */

    addCharacter : async function(req,res) {
        let [currentCharacter] = await dbP.execute("SELECT character_id FROM users_servers WHERE server_id = ? AND user_id = ?;",[req.body.serverId,req.userId]);
        if (currentCharacter[0].character_id != null) {
            res.send({error:"Персонаж уже существует", data:currentCharacter[0].character_id});
            return;
        }

        // Добавляем персонажа в БД
        db.query("INSERT INTO `character` VALUES (NULL,?,?,?,0,0,0,?,?,NULL,NULL);",
            [req.body.characterName, req.userId, req.body.serverId, req.body.date, req.body.character_avatar],
            async function(err,result) {
                // Заносим значения аттрибутов из анкеты
                let characterId = result.insertId;
                let attributes = JSON.parse(req.body.attributes);
                attributes.forEach((attribute, order) => {
                    if (attribute.type == "text")
                        dbP.execute("INSERT INTO characters_attributes VALUES(NULL,?,?,NULL,?,NULL);",
                            [characterId, attribute.id, attribute.value]);
                    else
                        dbP.execute("INSERT INTO characters_attributes VALUES(NULL,?,?,?,NULL,NULL);",
                            [characterId, attribute.id, attribute.value]);
                })
                // await dbP.execute("UPDATE users_servers SET character_id=? WHERE server_id = ? AND user_id=? ;",[characterId,req.body.serverId,req.userId]);
            }
        )
        res.send({success: 1});
    },

    deleteCharacter : async function(req, res) {
        let [user_id] = await dbP.execute("SELECT user_id FROM `character` WHERE id=?;", [req.query.characterId]);
        if (req.userId != user_id[0].user_id) {
            res.status(403).send({error:"access denied"});
            return;
        }

        dbP.execute("DELETE FROM `character` WHERE id=?;", [req.query.characterId]);
        res.send({success: 1})
    },

    uploadCharacterAvatar : async function(req,res) {

        let [owner] = await dbP.execute("SELECT user_id FROM `character` WHERE id=?", [req.query.characterId]);
        owner = owner[0].user_id;
        if (owner != req.userId) {

            res.status(403).send({error:"access denied"});
        }
        else {

            const newName = require('crypto').randomBytes(10).toString('hex') +"."+ req.files.character_avatar.name.split(".").pop();

            fs.rename(req.files.character_avatar.tempFilePath,"upload/"+newName,(err)=>{});

            dbP.execute("UPDATE `character` SET avatar=? WHERE user_id=?",[newName,req.userId]);

            res.send({character_avatar:newName});
        }

    }
}
