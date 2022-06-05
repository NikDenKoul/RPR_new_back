const mysql = require("mysql2");
const {raw} = require("express");
const fs = require("fs");
const ValidatingFunctions = require("./ValidatingFunctions");

const db = mysql.createPool({
    connectionLimit: 15,
    host: "localhost",
    user: "db_user",
    database: "u0860595_rp_ruler",
    password: "bB2ETA5wgR5ZjfQc"
});
const dbP = db.promise();

/** ========== Взаимодействие с игровыми персонажами ========== */
module.exports = {

    /** ========== Пользователь-владелец персонажа ========== */

    /**
     * Создать нового персонажа
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
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

    /**
     * Удалить имеющегося персонажа
     * @param req.query.characterId - id удаляемого персонажа
     * @param res
     * @returns {Promise<void>}
     */
    deleteCharacter : async function(req, res) {
        let [user_id] = await dbP.execute("SELECT user_id FROM `character` WHERE id=?;", [req.query.characterId]);
        if (req.userId != user_id[0].user_id) {
            res.status(403).send({error:"access denied"});
            return;
        }

        dbP.execute("DELETE FROM `character` WHERE id=?;", [req.query.characterId]);
        res.send({success: 1})
    },

    /**
     * Обновить аватар персонажа
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
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

    },

    /** ========== Пользователь-администратор ========== */

    confirmCharacter : async function(req,res) {

        // Получение Id сервера, на котором утверждается персонаж
        let [serverId] = await dbP.execute("SELECT server_id FROM `character` WHERE id=?;",[req.query.characterId]);
        serverId = serverId[0].server_id;

        // Проверка прав доступа утверждения анкет
        let permission = await ValidatingFunctions.checkRights("is_gm",req.userId,serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }

        // Обновляем поля в таблице с персонажами
        await dbP.execute("UPDATE `character` SET `is_confirmed` = TRUE, `is_rejected` = FALSE, `level` = 1, `exp` = 0 WHERE (`id`=?);",[req.query.characterId]);

        // Делаем последнее замечание неактуальным
        await dbP.execute("UPDATE `characters_responds` SET `is_actual` = FALSE WHERE (`character_id`=?);",[req.query.characterId]);

        // Создаём значения вторичных аттрибутов
        let [attributes] = await dbP.execute("SELECT attribute_id, value FROM levels_attributes " +
            "LEFT JOIN level ON lvl_id=level.id " +
            "WHERE level.server_id=? AND level.num=1;",[serverId]);
        attributes.forEach((attribute) => {
            dbP.execute("INSERT INTO characters_attributes VALUES(NULL,?,?,?,NULL,?);",[req.query.characterId,attribute.attribute_id,attribute.value,attribute.value])
        })

        // Посылаем ответ об успехе
        res.send({success:1});
    },

    rejectCharacter : async function(req,res) {

        // Получение Id сервера, на котором отклоняется персонаж
        let [serverId] = await dbP.execute("SELECT server_id FROM `character` WHERE id=?;",[req.body.characterId]);
        serverId = serverId[0].server_id;

        // Проверка прав доступа отклонения анкет
        let permission = await ValidatingFunctions.checkRights("is_gm",req.userId,serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }

        // Обновление полей в таблице с персонажами
        await dbP.execute("UPDATE `character` SET `is_confirmed` = FALSE, `is_rejected` = TRUE, `level` = NULL, `exp` = NULL WHERE (`id`=?);",[req.body.characterId]);

        // Добавляем комментарий от админа владельцу анкеты
        await dbP.execute("INSERT INTO `characters_responds` VALUES(NULL,?,?,1,?,?);",
            [req.body.characterId,req.body.comment,req.body.date,req.userId]);

        // Удаляем значения вторичных аттрибутов
        let [attributes] = await dbP.execute("SELECT id FROM attribute WHERE isGeneral=0;")
        attributes.forEach((attribute) => {
            dbP.execute("DELETE FROM characters_attributes WHERE character_id=? AND attribute_id=?",[req.query.characterId,attribute.id]);
        })

        res.send({success:1});
    },

    /**
     * Получить всех персонажей (в т. ч. анкеты) с последним актуальным ответом администрации (ГМов)
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    getCharacters : async function(req,res) {

        let [characters] = await dbP.execute("SELECT `character`.id, `character`.characterName, user_owner.login AS `owner`, `character`.last_edit, " +
            "`character`.is_confirmed, `character`.is_rejected, `character`.is_frozen, " +
            "comment_author.login AS author, " +
            "characters_responds.respond_comment, characters_responds.resp_last_edit " +
            "FROM `character` " +
            "LEFT JOIN `user` AS user_owner ON `character`.user_id = user_owner.id " +
            "LEFT JOIN characters_responds ON `character`.id = characters_responds.character_id " +
            "LEFT JOIN `user` AS comment_author ON `characters_responds`.author_id = comment_author.id " +
            "WHERE server_id = ? " +
            "AND (is_actual=true OR is_rejected=false);",
            [req.query.serverId]);
        res.send({characters:characters});
    },

    /** ========== Общий доступ ========== */

    /**
     * Получить информацию об одном персонаже по его id
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    getCharacterById : async function(req,res) {

        let [character] = await dbP.execute("SELECT `character`.*, `level`.required_exp FROM `character` " +
            "LEFT JOIN `level` ON `character`.server_id=`level`.server_id " +
            "WHERE `character`.id=? AND (`level`.num=`character`.level+1 OR is_confirmed=0 AND `level`.num=1);",
            [req.query.characterId])
        let [attributes] = await dbP.execute("SELECT `name`, `type`, short_value, long_value, current_value, isGeneral " +
            "FROM characters_attributes " +
            "LEFT JOIN attribute ON attribute_id=attribute.id " +
            "WHERE character_id=? " +
            "ORDER BY isGeneral DESC, attribute_id;",
            [req.query.characterId]);
        let [responds] = await dbP.execute("SELECT respond_comment, is_actual, resp_last_edit, " +
            "user.login AS author, user.avatar FROM characters_responds " +
            "LEFT JOIN user ON author_id=user.id " +
            "WHERE character_id=? " +
            "ORDER BY resp_last_edit;",
            [req.query.characterId]);
        res.send({character:character[0], attributes:attributes, responds:responds});
    },

    /**
     * Получить информацию об одном персонаже по id владельца
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    getCharacterByUserId : async function(req,res) {

        let [character] = await dbP.execute("SELECT `character`.*, `level`.required_exp FROM `character` " +
            "LEFT JOIN `level` ON `character`.server_id=`level`.server_id " +
            "WHERE `character`.user_id=? AND (`level`.num=`character`.level+1 OR is_confirmed=0 AND `level`.num=1) " +
            "AND `character`.server_id=?;",
            [req.userId,req.query.serverId])
        let [attributes] = await dbP.execute("SELECT `name`, `type`, short_value, long_value, current_value, isGeneral " +
            "FROM characters_attributes " +
            "LEFT JOIN attribute ON attribute_id=attribute.id " +
            "LEFT JOIN `character` ON character_id=`character`.id " +
            "WHERE user_id=? " +
            "ORDER BY isGeneral DESC, attribute_id;",
            [req.userId]);
        let [responds] = await dbP.execute("SELECT respond_comment, is_actual, resp_last_edit, " +
            "user.login AS author, user.avatar FROM characters_responds " +
            "LEFT JOIN `character` ON character_id=`character`.id " +
            "LEFT JOIN user ON author_id=user.id " +
            "WHERE `character`.user_id=? " +
            "ORDER BY resp_last_edit;",
            [req.userId]);
        res.send({character:character[0], attributes:attributes, responds:responds});
    }
}