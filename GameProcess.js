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

        let permission = await ValidatingFunctions.isRoomLocation(req.query.roomId);
        if (!permission) {
            res.send({success: 0, err: "Room is not a location", permission: permission})
            return;
        }
        let [characters] = await dbP.execute("SELECT * FROM `character` WHERE current_location_id=?;",[req.query.roomId])
        res.send({success: 1, characters: characters});
        return;
    },

    /**
     * Переместить персонажа в новую локацию
     *
     * @param {int} req.userId - id пользователя, пославшего запрос
     * @param {object} req.body -
     * @param {int} req.body.characterId - id персонажа, который должен сменить локацию
     * @param {int} req.body.roomId - id комнаты (локации), в которую должен переместиться персонаж
     * @param res
     * @returns {Promise<void>}
     */
    spawnInLocation : async function(req,res) {
        const character_id = req.body.characterId;
        const user_id = req.userId;

        // Проверка прав
        if (!await ValidatingFunctions.compareUserAndCharacter(user_id, character_id)) {
            res.send({success: 0, err: "Попытка выполнить действие за чужего персонажа"})
            return;
        }

        // Проверка, что новая комната является локацией
        if (!await ValidatingFunctions.isRoomLocation(req.body.roomId)) {
            res.send({success: 0, err: "Комната не является локацией"})
            return;
        }

        // Сменить локацию для персонажа
        dbP.execute("UPDATE `character` SET current_location_id=? WHERE id=?;",
            [req.body.roomId,req.body.characterId]);

        res.send({success: 1});
    },

    /** ========== Игровые сражения ========== */

    /**
     * Вызвать другого персонажа на битву
     *
     * @param req - запрос
     * @param req.body - тело запроса
     * @param {int} req.body.senderId - id персонажа, бросающего вызов
     * @param {int} req.body.recipient - id персонажа, кому бросается вызов
     * @param {int} req.body.location - id локации, на которой проводится сражение
     * @param res
     * @returns {Promise<void>}
     */
    sendBattleRequest : async function(req,res) {

        let cur_date = new Date();
        let cur_date_str = cur_date.getFullYear() + "-" +
            (cur_date.getMonth()<9 ? "0" : "") + (cur_date.getMonth() + 1) + "-" +
            (cur_date.getDate()<10 ? "0" : "") + cur_date.getDate() + "T" +
            (cur_date.getHours()<10 ? "0" : "") + cur_date.getHours() + ":" +
            (cur_date.getMinutes()<10 ? "0" : "") + cur_date.getMinutes() + ":" +
            (cur_date.getSeconds()<10 ? "0" : "") + cur_date.getSeconds();

        dbP.execute("INSERT INTO start_battle_request VALUES(NULL,?,?,?,?,NULL);",
            [req.body.senderId,req.body.recipient,cur_date_str,req.body.location]);

        res.send({success:1});
    },

    /**
     * Принять призыв к сражению
     *
     * @param {object} req - запрос
     * @param {int} req.query.requestId - id запроса на начало сражения
     * @param res - ответ
     * @returns {Promise<void>}
     */
    confirmBattleRequest : async function(req,res) {
        let [request] = await dbP.execute("SELECT sender_id, recipient, location FROM start_battle_request " +
            "WHERE id=?;",[req.query.requestId]);
        let participants = [request[0].sender_id, request[0].recipient];
        const location_id = request[0].location;
        let err = null;

        await private_startBattle(participants, location_id, err);
        if (err != null) {
            res.send({success:0, err:err.err_text});
            return;
        }
        dbP.execute("UPDATE start_battle_request SET respond=1 WHERE id=?;",[req.query.requestId]);
        res.send({success:1});
    },

    /**
     * Отклонить призыв к сражению
     *
     * @param req
     * @param {int} req.query.requestId - id запроса на начало сражения
     * @param res
     * @returns {Promise<void>}
     */
    rejectBattleRequest : async function(req,res) {
        dbP.execute("UPDATE start_battle_request SET respond=0 WHERE id=?;",[req.query.requestId]);
        res.send({success:1});
    },

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
            let new_participants = [actor,actions[0].target_id]
            let err = null;
            await private_startBattle(new_participants, actor_character[0].current_location_id, err);
            if (err != null) {

            }
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
    },

    getCurrentTurn: async function(req,res) {
        let [turn] = await dbP.execute("SELECT battle_participants.character_id FROM battle " +
            "LEFT JOIN battle_participants ON battle.id=battle_participants.battle_id " +
            "WHERE date_of_end IS NULL AND location_id=? AND `order`=current_turn;",
            [req.query.locationId]);
        turn = turn.length == 0 ? 0 : turn[0].character_id;
        res.send({turn:turn});
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

/**
 * Начать новое сражение
 *
 * @param {int[]} participants - id'шники участников сражения
 * @param {int} location_id - локация проведения сражения
 * @param err - сообщение об ошибке
 * @returns {Promise<void>}
 */
async function private_startBattle(participants,location_id,err) {

    // Список персонажей в текущей локации
    const [characters_in_location] = await dbP.execute("SELECT id FROM `character` " +
        "WHERE location_id=?;",[location_id])
    // Список персонажей, сражающихся где-либо
    const [characters_in_battle] = await dbP.execute("SELECT character_id FROM battle_participants " +
        "WHERE result=NULL;")

    // Проверяем, что все участники в одной локации И никто пока ещё не сражается
    for (const character_id of participants) {
        if (characters_in_location.find((character) => character.id == character_id) == null) {
            const character_name = dbP.execute("SELECT characterName FROM `character` WHERE id=?;",
                [character_id])
            err.send({err_text: "Персонаж " + character_name[0].characterName + " находится в другой локации."});
            return;
        }

        if (characters_in_battle.find((character) => character.id == character_id) != null) {
            const character_name = dbP.execute("SELECT characterName FROM `character` WHERE id=?;",
                [character_id])
            err.send({err_text: "Персонаж " + character_name[0].characterName + " участвует в другом сражении."});
            return;
        }
    }

    // Получаем текущую дату - это будет дата начала сражения
    let cur_date = new Date();
    let cur_date_str = cur_date.getFullYear() + "-" +
        (cur_date.getMonth()<9 ? "0" : "") + (cur_date.getMonth() + 1) + "-" +
        (cur_date.getDate()<10 ? "0" : "") + cur_date.getDate() + "T" +
        (cur_date.getHours()<10 ? "0" : "") + cur_date.getHours() + ":" +
        (cur_date.getMinutes()<10 ? "0" : "") + cur_date.getMinutes() + ":" +
        (cur_date.getSeconds()<10 ? "0" : "") + cur_date.getSeconds();

    // Создаём новой сражение в БД
    db.query("INSERT INTO battle VALUES(NULL,?,NULL,?,1);",
        [cur_date_str,location_id],
        async function(err,data) {
            let battle_id = data.insertId;
            let next_order = 1;

            for (const id of participants) {
                dbP.execute("INSERT INTO battle_participants VALUES(NULL,?,?,?,NULL);",
                    [battle_id,id,next_order]);
                next_order++;
            }

            return;
        });
    return;
}
