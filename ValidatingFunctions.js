
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

/** */
module.exports = {
    /**
     * Проверить права пользователя на что-либо
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

// async function checkRights(right,userId,serverId){
//     let [adminServer] = await dbP.execute("SELECT * FROM server WHERE admin_id=? AND id=?",[userId,serverId]);
//     let [roles] = await dbP.execute("SELECT role.* FROM users_servers JOIN role ON role.id=users_servers.role_id\n" +
//         "                                    WHERE users_servers.server_id=? AND users_servers.user_id=?",[serverId,userId]);
//     if(roles.length === 0 && adminServer.length === 0)return false;
//     return roles[0][right] == 1 || adminServer.length !== 0;
// }
//
// function verifyToken(req,res,next){
//     db.query("SELECT id FROM user WHERE token=?",[req.token], function(err, data) {
//         if(err != null || data.length === 0){
//             res.status(403).send({"error":"invalid token"});
//         }else{
//             req.userId = data[0].id;
//             next();
//         }
//     });
// }
//
// function verifyFields(req,res,next){
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//         return res.status(400).json({ error: errors.array() });
//     }else{
//         next();
//     }
// }
