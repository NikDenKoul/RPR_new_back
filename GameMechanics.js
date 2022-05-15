
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
    }
}


// app.put("/attributes",
//     body("serverId").isInt(),
//     body("attributes").toArray().isArray({min:1}),
//     body("attributes").toArray().isArray(),
//     body("deletedIds").toArray().isArray({min:1}),
//     body("deletedIds").toArray().isArray(),
//     verifyFields,verifyToken,
//     async function(req,res) {
//         // Парсинг массива аттрибутов
//         let attributes = JSON.parse(req.body.attributes);
//         let deletedIds = JSON.parse(req.body.deletedIds);
//         let serverId = req.body.serverId;
//
//         // Проверка прав доступа для редактирования набора аттрибутов
//         let permission = await checkRights("server_edit",req.userId,serverId);
//         if(!permission){
//             res.status(403).send({error:"access denied"});
//             return;
//         }
//
//         // Изменение набора аттрибутов на сервере
//         attributes.forEach((attribute, order) => {
//                 // Добавление нового аттрибута (т. к. id'шник был нулевой, присваивается новый)
//                 if (attribute.id <= 0) {
//                     dbP.execute("INSERT INTO attribute VALUES (NULL, ?, ?, ?, ?);",
//                         [serverId, attribute.name, attribute.type, attribute.isGeneral]);
//                 }
//                 // Обновление существующего аттрибута
//                 else {
//                     dbP.execute("UPDATE attribute SET server_id=?, name=?, type=?, isGeneral=? WHERE id=?;",
//                         [serverId, attribute.name, attribute.type, attribute.isGeneral, attribute.id]);
//                 }
//             }
//         )
//
//         // Удаление аттрибутов
//         deletedIds.forEach((attribute_id) => {
//             dbP.execute("DELETE FROM attribute WHERE id=?",[attribute_id]);
//         })
//
//         res.send({success:1});
//     }
// )
//
// app.delete("/attributes", query("id").isInt(), verifyFields,verifyToken, async function (req,res){
//         // Получение Id сервера, на котором удаляется аттрибут из набора
//         let [serverId] = await dbP.execute("SELECT server_id FROM attribute WHERE id=?;",[req.query.id]);
//         serverId = serverId[0].server_id;
//
//         // Проверка прав доступа удаления аттрибута
//         let permission = await checkRights("server_edit",req.userId,serverId);
//         if(!permission){
//             res.status(403).send({error:"access denied"});
//             return;
//         }
//
//         // Удаление аттрибута из набора
//         await dbP.execute("DELETE FROM attribute WHERE id=?",[req.query.id]);
//         res.send({success:1});
//     }
// )
//
// app.get("/profile_attributes",query("serverId").isInt(),verifyFields,verifyToken,async function (req,res){
//     let [data] = await dbP.execute("SELECT `attribute`.* FROM attribute WHERE attribute.server_id = ? AND  isGeneral = 1;",
//         [req.query.serverId]);
//     res.send({data:data});
// })
//
// app.get("/all_attributes",query("serverId").isInt(),verifyFields,verifyToken,async function (req,res){
//     let [data] = await dbP.execute("SELECT `attribute`.* FROM attribute WHERE attribute.server_id = ?",
//         [req.query.serverId]);
//     res.send({data:data});
// })
//
// /** ========== Взаимодействие с системой опыта ========== */
//
// /**
//  * Обновить набор аттрибутов
//  * @param body.serverId - id сервера, на котором проводятся изменения
//  * @param body.levels - добавляемые и обновляемые уровни
//  * @param body.deletedIds - id'шники удаляемых аттрибутов
//  */
// app.put("/levels",
//     body("serverId").isInt(),
//     body("levels").toArray().isArray({min:1}),
//     body("levels").toArray().isArray(),
//     body("deletedIds").toArray().isArray({min:1}),
//     body("deletedIds").toArray().isArray(),
//     verifyFields,verifyToken,
//     async function(req,res){
//         let levels = JSON.parse(req.body.levels);
//         let deletedIds = JSON.parse(req.body.deletedIds);
//         let serverId = req.body.serverId;
//
//         // Проверка прав доступа для редактирования набора аттрибутов
//         let permission = await checkRights("server_edit",req.userId,serverId);
//         if(!permission){
//             res.status(403).send({error:"access denied"});
//             return;
//         }
//
//         // Получаем аттрибуты на сервере
//         let [attributes] = await dbP.execute("SELECT `id`, `name` FROM attribute WHERE server_id=? AND isGeneral=FALSE",[serverId]);
//
//         // Изменение набора уровней на сервере
//         levels.forEach((level, order) => {
//                 // Добавление нового уровня (т. к. id'шник был нулевой, присваивается новый)
//                 if (level.id <= 0) {
//                     db.query("INSERT INTO level VALUES (NULL, ?, ?, ?);",[level.num, level.required_exp, serverId],async function(err,data){
//                         let lvl_id = data.insertId
//                         attributes.forEach((attribute) => {
//                             dbP.execute("INSERT INTO levels_attributes VALUES (NULL,?,?,?);",[lvl_id,attribute.id,level[attribute.name]]);
//                         })
//                     });
//                 }
//                 // Обновление существующего уровня
//                 else {
//                     dbP.execute("UPDATE level SET num=?, required_exp=?, server_id=? WHERE id=?;",
//                         [level.num, level.required_exp, serverId, level.id]);
//                     attributes.forEach((attribute) => {
//                         dbP.execute("UPDATE levels_attributes SET value=? WHERE lvl_id=? AND attribute_id=?;",[level[attribute.name],level.id,attribute.id]);
//                     })
//                 }
//             }
//         )
//
//         // Удаление аттрибутов
//         deletedIds.forEach((lvl_id) => {
//             dbP.execute("DELETE FROM level WHERE id=?",[lvl_id]);
//         })
//
//         res.send({success:1});
//     })
//
// /**
//  * Получить значения всех аттрибутов по уровням
//  */
// app.get("/levels",query("serverId").isInt(),verifyFields,verifyToken,async function(req,res){
//     let [levels] = await dbP.execute("SELECT * FROM `level` WHERE server_id=?;",[req.query.serverId]);
//
//     let [levels_attributes] = await dbP.execute("SELECT `levels_attributes`.id, lvl_id, `level`.num, attribute.`name`, `value` FROM `levels_attributes` " +
//         "LEFT JOIN `level` ON lvl_id=`level`.id " +
//         "LEFT JOIN attribute ON attribute_id=attribute.id " +
//         "WHERE `level`.server_id = ? " +
//         "ORDER BY `level`.num;",
//         [req.query.serverId]);
//
//     res.send({levels:levels, levels_attributes:levels_attributes});
// })
