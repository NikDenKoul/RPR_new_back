
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

    getGameSettings : async function(req, res) {
        let [game_settings] = await dbP.execute("SELECT * FROM game_settings WHERE server_id=?;",[req.query.serverId]);
        game_settings = game_settings[0];

        res.send({game_settings: game_settings});
    },

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
                    db.query("INSERT INTO level VALUES (NULL, ?, ?, ?, ?);",[level.num, level.required_exp, level.AP, serverId],async function(err,data){
                        let lvl_id = data.insertId
                        attributes.forEach((attribute) => {
                            dbP.execute("INSERT INTO levels_attributes VALUES (NULL,?,?,?);",[lvl_id,attribute.id,level[attribute.name]]);
                        })
                    });
                }
                // Обновление существующего уровня
                else {
                    dbP.execute("UPDATE level SET num=?, required_exp=?, AP=?, server_id=? WHERE id=?;",
                        [level.num, level.required_exp, level.AP, serverId, level.id]);
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

    /**
     * Получить распределение награды по всем категориям и размерам постов
     */
    getPostsRating : async function(req,res) {
        let [posts_rating] = await dbP.execute("SELECT * FROM posts_rating WHERE server_id=?;",[req.query.serverId]);

        res.send({posts_rating: posts_rating});
    },

    editPostsRating : async function(req,res) {
        let posts_rating = JSON.parse(req.body.postsRating);
        let deletedIds = JSON.parse(req.body.deletedIds);
        let serverId = req.body.serverId;

        // Проверка прав доступа для редактирования распределения наград за посты
        let permission = await ValidatingFunctions.checkRights("is_gm",req.userId,serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }

        //let prev_upper_limit = -1;
        // Изменение набора уровней на сервере
        posts_rating.forEach((rating) => {
                if (rating.id <= 0) {
                    dbP.execute("INSERT INTO posts_rating VALUES (NULL,?,?,?,?,?);",
                        [serverId, rating.name, rating.upper_limit, rating.exp_for_routine, rating.exp_for_plot]);
                }

                else {
                    dbP.execute("UPDATE posts_rating SET server_id=?, name=?, upper_limit=?, exp_for_routine=?, exp_for_plot=? WHERE id=?;",
                        [serverId, rating.name, rating.upper_limit, rating.exp_for_routine, rating.exp_for_plot, rating.id]);
                }
            }
        )

        deletedIds.forEach((rating_id) => {
            dbP.execute("DELETE FROM posts_rating WHERE id=?",[rating_id]);
        })

        res.send({success:1});
    },

    /** ========== Взаимодействие с ситемой сражений ========== */

    /**
     *
     * @param {object} req.body -
     * @param {int} req.body.serverId -
     * @param {int} req.body.fight_settings_flags.attack_AP_cost - стоимость ОД за атаку (NULL если не разрешены на сервере)
     * @param {int} req.body.fight_settings_flags.dodge_AP_cost - стоимость ОД за уворот (NULL если не разрешены на сервере)
     * @param {int} req.body.fight_settings_flags.skills_enable - разрешить способности на сервере
     * @param {int} req.body.fight_settings_flags.HP_attribute - аттрибут, отвечающий за здоровье персонажей
     * @param {string} req.body.fight_settings_flags -
     * @param {string} req.body.attack_settings_damage -
     * @param {string} req.body.deleted_ids -
     * @param res
     * @returns {Promise<void>}
     */
    editAttackSettings : async function(req,res) {

        const fight_settings_flags = JSON.parse(req.body.fight_settings_flags);
        const attack_settings_damage = JSON.parse(req.body.attack_settings_damage);
        const deleted_ids = JSON.parse(req.body.deleted_ids)


        // Разрешённые действия во время сражений + стоимость ОД
        dbP.execute("UPDATE game_settings SET attack_AP_cost=?, dodge_AP_cost=?, skills_enable=?, HP_attribute=? " +
            "WHERE server_id=?;",[fight_settings_flags.attack_AP_cost,fight_settings_flags.dodge_AP_cost,
        fight_settings_flags.skills_enable,fight_settings_flags.HP_attribute,req.body.serverId])

        // Настройки атаки
        for (const settings of attack_settings_damage) {
            if (settings.id > 0) {
                dbP.execute("UPDATE attack_settings SET effect_type=?, considered_attribute_id=?, " +
                    "attribute_owner=? WHERE id=?;",
                    [settings.effect_type,settings.considered_attribute_id, settings.attribute_owner,settings.id]);
            }
            else {
                dbP.execute("INSERT INTO attack_settings VALUES(NULL,?,?,?);",
                    [settings.effect_type,settings.considered_attribute_id,settings.attribute_owner]);
            }
        }

        for (const id of deleted_ids) {
            dbP.execute("DELETE FROM attack_settings WHERE id=?;",[id]);
        }

        res.send({success: 1});
    },

    /**
     * Получить настройки атаки
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    getFightSettings : async function(req, res) {
        const [fight_settings_flags] = await dbP.execute("SELECT attack_AP_cost, dodge_AP_cost, skills_enable, " +
            "HP_attribute FROM game_settings WHERE server_id=?;",[req.query.serverId]);

        let [attack_settings_damage] = await dbP.execute("SELECT attribute.server_id, attack_settings.* " +
            "FROM attack_settings " +
            "LEFT JOIN attribute ON considered_attribute_id=attribute.id " +
            "WHERE server_id=?;",[req.query.serverId]);
        res.send({fight_settings_flags: fight_settings_flags[0], attack_settings_damage: attack_settings_damage});
    }
}
