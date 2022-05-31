const mysql = require("mysql2");
const {raw} = require("express");

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
        let [posts] = await dbP.execute("SELECT room.name, `character`.id AS characterId, `character`.characterName, `character`.avatar,\n" +
            " message.id AS post_id, message.text, message.datetime, game_post.is_checked FROM message\n" +
            "INNER JOIN `room` ON room_id=room.id\n" +
            "INNER JOIN `user` ON sender_id=`user`.id\n" +
            "INNER JOIN `character` ON `user`.id = `character`.user_id\n" +
            "INNER JOIN game_post ON message.id=game_post.message_id\n" +
            "WHERE room.is_location = 1 AND room.server_id=? AND `character`.is_confirmed=1\n" +
            "AND game_post.is_checked=0 AND message.flag=0 ORDER BY characterId",
            [req.query.serverId]);

        res.send({posts: posts});
    },

    giveExpForPosts : async function(req,res) {

        let [posts_rating] = await dbP.execute("SELECT * FROM posts_rating WHERE server_id=?;",[req.body.serverId]);
        let [levels] = await dbP.execute("SELECT * FROM `level` WHERE server_id=? ORDER BY num;",[req.body.serverId]);
        if (posts_rating.length == 0) {
            res.send({error: "Could not get posts_rating"});
            return;
        }
        if (levels.length == 0) {
            res.send({error: "Could not get levels"});
            return;
        }

        let posts = JSON.parse(req.body.posts);

        for (const posts_set of posts) {

            let [character] = await dbP.execute("SELECT level, exp FROM `character` WHERE id=?;",[posts_set.id]);
            let character_exp = character[0].exp;
            let character_lvl = character[0].level;
            let routine_posts_length = 0;
            let plot_posts_length = 0;

            // накапливаем суммарные размеры постов: отдельно за сюжетные и рутинные
            let posts_list = posts_set.posts_list;
            // res.send({message: "catch", name: posts_set.characterName});
            // return;

            for (const post of posts_list) {

                if (post.is_plot) plot_posts_length += post.text.length;
                else routine_posts_length += post.text.length;

                await dbP.execute("UPDATE game_post SET is_checked=1 WHERE message_id=?",[post.id]);
            }


            // накапливаем опыт за посты
            let routine_lower_limit = 0;
            let plot_lower_limit = 0;
            posts_rating.forEach(rating => {
                if (routine_posts_length >= routine_lower_limit && routine_posts_length <= rating.upper_limit) {
                    character_exp += rating.exp_for_routine;
                }
                if (plot_posts_length >= plot_lower_limit && plot_posts_length <= rating.upper_limit) {
                    character_exp += rating.exp_for_plot;
                }
                routine_lower_limit = rating.upper_limit;
                plot_lower_limit = rating.upper_limit;
            })
            if (character_exp == 0) {
                res.send({error: "Could not calculate character experience"});
                return;
            }

            // повышаем уровень при необходимости
            levels.forEach(level => {
                if ((level.num == character_lvl+1) && (level.required_exp <= character_exp)) {
                    character_lvl++;
                    character_exp -= level.required_exp;
                }
            })

            // обновляем значения опыта и уровня персонажа
            dbP.execute("UPDATE `character` SET exp=? WHERE id=?;",[character_exp,posts_set.id]);

            // обновляем значения вторичных аттрибутов
            let [attributes] = await dbP.execute("SELECT attribute_id, value FROM levels_attributes " +
                                               "LEFT JOIN level ON lvl_id=level.id " +
                                               "WHERE level.server_id=? AND level.num=?;",
                [req.body.serverId,character_lvl]);

            attributes.forEach((attribute) => {
                dbP.execute("UPDATE characters_attributes SET short_value=?, current_value=? " +
                                "WHERE character_id=? AND attribute_id=?;",
                    [attribute.value,attribute.value,posts_set.id,attribute.attribute_id])
            })
        }

        res.send({success: 1});
    }
}
