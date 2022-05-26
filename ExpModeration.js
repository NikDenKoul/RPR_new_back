const mysql = require("mysql2");

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
     *
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    getPosts: async function(req,res) {
        let [posts] = await dbP.execute("SELECT room.name, `character`.id AS characterId, `character`.characterName, " +
                                            "`character`.avatar, message.id AS post_id, message.text, message.datetime FROM message " +
                                            "INNER JOIN `room` ON room_id=room.id " +
                                            "INNER JOIN `user` ON sender_id=`user`.id " +
                                            "INNER JOIN `character` ON `user`.id = `character`.user_id " +
                                            "WHERE room.is_location = 1 AND room.server_id=? AND `character`.is_confirmed=1 " +
                                            "ORDER BY characterId;",
            [req.query.serverId]);

        res.send({posts: posts});
    }
}
