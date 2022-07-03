
// Функции валидации полей, токена и проверки прав пользователя

const mysql = require("mysql2");
const { validationResult } = require('express-validator');

const db = mysql.createPool({
    connectionLimit: 15,
    host: "localhost",
    user: "db_user",
    database: "u0860595_rp_ruler",
    password: "bB2ETA5wgR5ZjfQc"
});
const dbP = db.promise();

module.exports = {
    /**
     * Проверить права пользователя на что-либо (в соответствии с ролью на сервере)
     * @param right
     * @param userId
     * @param serverId
     * @returns {Promise<boolean>}
     */
    checkRights: async function (right,userId,serverId){
        let [adminServer] = await dbP.execute("SELECT * FROM server WHERE admin_id=? AND id=?",[userId,serverId]);
        let [roles] = await dbP.execute("SELECT role.* FROM users_servers JOIN role ON role.id=users_servers.role_id\n" +
            "                                    WHERE users_servers.server_id=? AND users_servers.user_id=?",[serverId,userId]);
        if(roles.length === 0 && adminServer.length === 0)return false;
        return roles[0][right] == 1 || adminServer.length !== 0;
    },

    /**
     * Проверить, принадлежит ли персонаж пользователю
     *
     * @param user_id - id пользователя
     * @param character_id - id персонажа
     */
    compareUserAndCharacter : async function (user_id, character_id) {

        let [actual_owner] = dbP.execute("SELECT user_id FROM `character` WHERE id=?;",[character_id]);
        actual_owner = actual_owner[0].user_id;

        if (actual_owner == user_id) return true;
        else return false;
    },

    /**
     * Проверить, является ли комната игровой локацией
     *
     * @param room_id - id комнаты
     * @returns {Promise<boolean>}
     */
    isRoomLocation : async function (room_id) {

        let [room] = await dbP.execute("SELECT * FROM `room` WHERE id=?;",[room_id]);
        return room[0].is_location;
    },

    verifyToken : async function (req,res,next){
        db.query("SELECT id FROM user WHERE token=?",[req.token], function(err, data) {
            if(err != null || data.length === 0){
                res.status(403).send({"error":"invalid token"});
            }else{
                req.userId = data[0].id;
                next();
            }
        });
    },

    verifyFields : async function (req,res,next){
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array() });
        }else{
            next();
        }
    }
}
