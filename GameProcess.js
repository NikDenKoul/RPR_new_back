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

    /**
     * Получить список персонажей, находящихся в заданной локации
     *
     * @param {int} req.query.roomId - ID комнаты (локации), для которой ведётся поиск
     * @param res
     * @returns {Promise<void>}
     */
    getCharactersInLocation : async function(req,res) {
        const [characters] = await dbP.execute("SELECT * FROM `character` WHERE current_location_id=?;",[req.query.roomId])
        res.send({characters: characters});
    },

    /**
     * Переместить персонажа в новую локацию
     *
     * @param {object} req.body -
     * @param {int} req.body.characterId -
     * @param {int} req.body.roomId -
     * @param res
     * @returns {Promise<void>}
     */
    spawnInLocation : async function(req,res) {
        const character_id = req.body.characterId;

        // Проверить права: либо владелец персонажа, либо ГМ

        // Сменить локацию для персонажа
        dbP.execute("UPDATE `character` SET current_location_id=? WHERE id=?;",
            [req.body.roomId,req.body.characterId]);

        res.send({success: 1});
    },

    /** ========== Игровые сражения ========== */

    /**
     * Начать сражение
     *
     * @param {object} req - запрос
     * @param {object} req.body - тело запроса
     * @param {int} req.body.serverId - ID сервера, на котором будет проходить сражение
     * @param {int} req.body.locationId - ID комнаты (локации), в которой будет проходить сражение
     * @param {string} req.body.date_of_start - дата начала сражения
     * @param {int[]} req.body.participants - участники сражения
     * @returns {Promise<void>}
     */
    startBattle : async function(req,res) {

        // Создаём новое сражение
        db.query("INSERT INTO battle VALUES(NULL,?,?,NULL,?,1);",
            [req.body.serverId,req.body.date_of_start,req.body.locationId],
            async function(err,data)
            {
                // Получаем id нового сражения
                const battle_id = data.insertId;

                // Определяем очерёдность хода

                // Добавляем участников в БД, указывая их очерёдность

                // Отправляем id персонажа, который ходит первым
            })
    },

    /**
     * Сделать ход
     *
     * @param {int} req.body.serverId - id сервера, на котором проходит сражение
     * @param {int} req.body.actor - id персонажа, совершившего ход
     * @param {string} req.body.actions - действия персонажа
     * @returns {Promise<void>}
     */
    makeMove : async function(req,res) {

        /**
         * Персонаж, совершающий ход
         * @type {Number}
         */
        const actor = req.body.actor;
        const [actor_character] = await dbP.execute("SELECT * FROM `character` WHERE id=?;",[actor]);
        const [battle] = await dbP.execute("SELECT battle.*, battle_participants.character_id, " +
            "battle_participants.order FROM battle " +
            "LEFT JOIN battle_participants ON battle.id=battle_participants.battle_id " +
            "WHERE date_of_end IS NULL AND character_id=?;",[actor]);


        // res.send({message:"here"})
        // return;
        const actions = JSON.parse(req.body.actions);

        let [game_settings] = await dbP.execute("SELECT * FROM game_settings WHERE server_id=?;",
            [req.body.serverId]);
        game_settings = game_settings[0];

        /**
         * Формулы для рассчета урона
         */
        const [attack_damage] = await dbP.execute("SELECT attribute.server_id, attack_settings.* " +
            "FROM attack_settings " +
            "LEFT JOIN attribute ON considered_attribute_id=attribute.id " +
            "WHERE server_id=?;",[req.body.serverId]);

        const [characters_attributes] = await dbP.execute(
            "SELECT characters_attributes.* FROM characters_attributes " +
            "LEFT JOIN attribute ON attribute_id=attribute.id " +
            "WHERE attribute.server_id=? AND attribute.isGeneral=0;",
            [req.body.serverId]);


        // Если драка не началась, мы её начинаем
        if (battle.length == 0) {
            let new_participants = [Number(actor),actions[0].target_id]
            let cur_date = new Date();
            let cur_date_str = cur_date.getFullYear() + "-" +
                (cur_date.getMonth()<9 ? "0" : "") + (cur_date.getMonth() + 1) + "-" +
                (cur_date.getDate()<10 ? "0" : "") + cur_date.getDate() + "T" +
                (cur_date.getHours()<10 ? "0" : "") + cur_date.getHours() + ":" +
                (cur_date.getMinutes()<10 ? "0" : "") + cur_date.getMinutes() + ":" +
                (cur_date.getSeconds()<10 ? "0" : "") + cur_date.getSeconds();

            db.query("INSERT INTO battle VALUES(NULL,?,?,NULL,?,1);",
                [req.body.serverId,cur_date_str,actor_character[0].current_location_id],
                async function(err,data) {
                    let battle_id = data.insertId;
                    let next_order = 1;

                    for (const id of new_participants) {
                        dbP.execute("INSERT INTO battle_participants VALUES(NULL,?,?,?,NULL);",
                            [battle_id,id,next_order]);
                        next_order++;
                    }

                    return;
                });
        }
        const [battle_participants] = await dbP.execute("SELECT * FROM battle_participants WHERE battle_id=?;",
            [battle[0].id])

        // Если драка уже идёт и очередь наша
        if (battle[0].current_turn == battle[0].order) {
            // Выполняем действия по очереди
            for (const action of actions) {
                // Рассчет атаки
                if (action.type == "attack") {
                    let damage = 0;
                    let target = action.target_id;

                    let formula_res = 0;
                    let attribute_owner = 0;

                    // Высчитываем значение наносимого урона
                    for (const formula of attack_damage) {
                        // Определяем реальный id владельца рассчитываемого аттрибута
                        if (formula.attribute_owner == "target") attribute_owner = target;
                        else if (formula.attribute_owner == "self") attribute_owner = actor;
                        else attribute_owner = 0;

                        // Получаем текущее значение аттрибута найденного владельца
                        formula_res = Number(findAttributeCurrentValue(characters_attributes,
                            attribute_owner,
                            formula.considered_attribute_id));

                        // Определяем знак
                        if (formula.effect_type == "decrease") formula_res = -formula_res;
                        else if (formula.effect_type == "increase");
                        else formula_res = 0;

                        // Рассчитываем итоговое значение урона
                        damage += formula_res;
                    }

                    // Не пропускаем отрицательное значение урона
                    if (damage < 0) damage = 0;

                    // Выполняем действие
                    dbP.execute("INSERT INTO attacks_log VALUES(NULL,1,?,?,?,NULL);",
                        [actor,damage,target]);
                }
            }

            // Получаем урон (пизды) от атак, от которых не увернулись
            const [incoming_attacks] = await dbP.execute("SELECT * FROM attacks_log " +
                "WHERE target=? AND dodged IS NULL;",[actor])

            let considered_target_HP = Number(findAttributeCurrentValue(characters_attributes,
                actor,game_settings.HP_attribute));

            for (const attack of incoming_attacks) {
                considered_target_HP -= attack.damage_value;
            }
            dbP.execute("UPDATE characters_attributes SET current_value=? " +
                "WHERE character_id=? AND attribute_id=?;",
                [considered_target_HP,actor,game_settings.HP_attribute]);
            dbP.execute("UPDATE attacks_log SET dodged=0 WHERE target=? AND dodged IS NULL;",
                [actor])

            // Передаём ход
            let new_turn = battle[0].current_turn == battle_participants.length ? 1 : battle[0].current_turn + 1;
            dbP.execute("UPDATE battle SET current_turn=? " +
                "WHERE id=?",[new_turn,battle[0].id])
        }


        res.send({success:1,battle_participants:battle_participants});
    }
}

/**
 *
 * @param characters_attributes
 * @param character_id
 * @param attribute_id
 */
function findAttributeCurrentValue(characters_attributes, character_id, attribute_id) {
    for (const attribute of characters_attributes) {
        if (attribute.character_id == character_id && attribute.attribute_id == attribute_id) {
            return attribute.current_value;
        }
    }
}
