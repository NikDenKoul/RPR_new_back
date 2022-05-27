
let express = require('express');
let app = express();
const mysql = require("mysql2");
const bearerToken = require('express-bearer-token');
let dateFormat = require('dateformat');
const https = require( "https" );
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const fileUpload = require('express-fileupload');
let cors = require('cors');
const { query, validationResult,body,param } = require('express-validator');

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200
});

httpsOptions = {
    key: fs.readFileSync("privkey1.pem"), // путь к ключу
    cert: fs.readFileSync("fullchain1.pem") // путь к сертификату
}

let https1 = https.createServer(httpsOptions, app)

io = require('socket.io')(https1,{
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }});

app.use(apiLimiter);
app.use(cors({origin: '*'}));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles : true,
    tempFileDir : '/tmp/'
}));
// for parsing multipart/form-data

app.use(function(request, response, next) {
    if (!request.secure) {
       return response.redirect("https://" + request.headers.host + request.url);
    }

    next();
})

app.use("/upload", express.static(__dirname + '/upload'));
app.use(express.static(__dirname + '/public'));
app.use("/login", express.static(__dirname + '/public'));
app.use("/restore", express.static(__dirname + '/public'));
app.use("/registration", express.static(__dirname + '/public'));


app.use(express.urlencoded({ extended: true}));

app.use(bearerToken());

const ValidatingFunctions = require('./ValidatingFunctions');
const GameMechanics = require('./GameMechanics');
const ExpModer = require('./ExpModeration');

const db = mysql.createPool({
    connectionLimit: 15,
    host: "localhost",
    user: "db_user",
    database: "u0860595_rp_ruler",
    password: "bB2ETA5wgR5ZjfQc"
});
const dbP = db.promise();



let clients = [];

io.on('connection', (socket) => {
    clients[socket.id] = {token:"",userId:0,roomId:0,serverId:0};
    if(socket.handshake.query.token != null) {
        db.query("SELECT * FROM user WHERE token=?", [socket.handshake.query.token],
            async function (err, user) {
                clients[socket.id].userId = user[0].id;
                clients[socket.id].token = socket.handshake.query.token;
                clients[socket.id].roomId = socket.handshake.query.roomId;
                let [serverId] = await dbP.execute("SELECT server_id FROM room WHERE id=?", [socket.handshake.query.roomId]);
                clients[socket.id].serverId = serverId[0].server_id;
                //Отмечаем пользователя в комнате
                dbP.execute("UPDATE user SET room_id=?,last_time_online=CURRENT_TIMESTAMP WHERE id=?;", [socket.handshake.query.roomId, user[0].id]);
                let [userData] = await dbP.execute("SELECT user.login,user.avatar,user.id,user.status,UNIX_TIMESTAMP(user.last_time_online) AS last_time_online,role.color,users_servers.role_id,role.role_order FROM user\n" +
                    "    LEFT JOIN users_servers ON users_servers.user_id = user.id AND" +
                    " users_servers.server_id=? LEFT JOIN role ON role.id=users_servers.role_id WHERE user.id=?", [serverId[0].server_id, user[0].id]);
                for (let clientId in clients) {
                    if (clients[clientId].roomId === socket.handshake.query.roomId) {
                        io.to(clientId).emit("new_user", userData[0]);
                    }
                }
            });
    }



    socket.on("delete_message",async (data)=>{
        let curRoomId = clients[socket.id].roomId;
        let userId    = clients[socket.id].userId;
        let serverId  = clients[socket.id].serverId;

        let [senderId] = await dbP.execute("SELECT sender_id FROM message WHERE id=?",[data.messageId]);
        senderId = senderId[0].sender_id;
        let canDelete = senderId == userId;
        //Если пользователь отправлял это сообщение
        if(!canDelete){
            let [senderRole] = await dbP.execute("SELECT role.role_order FROM users_servers\n" +
                "            LEFT JOIN role ON role.id = users_servers.role_id\n" +
                "            WHERE users_servers.server_id=? AND users_servers.user_id=?",[serverId,senderId]);
            senderRole = senderRole[0];
            let [userRole] = await dbP.execute("SELECT * FROM users_servers LEFT JOIN role ON role.id=users_servers.role_id\n" +
                "            WHERE users_servers.server_id=? AND users_servers.user_id=?",[serverId,userId]);
            userRole = userRole[0];
        }
        if(canDelete || (userRole.msg_delete*1 === 1 && userRole.role_order < senderRole.role_order)){
            dbP.execute("UPDATE message SET flag=1 WHERE id=?",[data.messageId]);
            for(let clientId in clients){
                if(clients[clientId].roomId === curRoomId){
                    io.to(clientId).emit("delete_message", {messageId:data.messageId});
                }
            }
        }
    })

    socket.on('message', (message) => {

        let curRoomId = clients[socket.id].roomId;
        let userId    = clients[socket.id].userId;
        let serverId  = clients[socket.id].serverId;

        db.query("INSERT INTO message VALUES(NULL,?,?,?,?,CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP,NULL);",
            [curRoomId+"",userId+"",message.reply_id,decodeURIComponent(message.text)],async function(err,data){
                if(err!=null)console.log(err);
                let messageId = data.insertId;

                let [is_location] = await dbP.execute("SELECT is_location FROM room WHERE id=?;",[curRoomId]);
                if (is_location[0].is_location === 1) dbP.execute("INSERT INTO game_post VALUES(NULL,?,0)",[messageId]);

                //записываем в комнату id последнего сообщения
                dbP.execute("UPDATE room SET last_msg_id=?,last_msg_time=CURRENT_TIMESTAMP WHERE id=?",[messageId,curRoomId]);
                //отмечаем прочитанным для отправителя
                dbP.execute("INSERT INTO room_user VALUES(NULL,?,?,?,0) ON DUPLICATE KEY UPDATE last_read_msg_id=?;",[curRoomId,userId,messageId,messageId]);
                //записываем в сервер id последнего сообщения
                dbP.execute("UPDATE server SET last_msg_id=? WHERE id=?",[messageId,serverId]);
                //получаем готовое сообщение
                let [message] = await dbP.execute("SELECT message.*,user.login,user.avatar,user.login,role.color,role.role_order FROM message JOIN user ON message.sender_id = user.id \n" +
                    "LEFT JOIN users_servers ON users_servers.user_id = user.id AND users_servers.server_id=? LEFT JOIN role ON role.id=users_servers.role_id\n" +
                    "WHERE message.id=?",[serverId,messageId]);
                message = message[0];
                //Прикрепляем ответ
                if(message.reply_id !== 0){
                    let [reply_message] = await dbP.execute("SELECT message.*,user.login,user.avatar,user.login FROM message JOIN user ON message.sender_id = user.id\n" +
                        "WHERE message.id=?",[message.reply_id]);
                    message.reply_message = reply_message[0];
                }
                let date = dateFormat(new Date(), "yyyy-mm-dd");
                message.datetime = dateFormat(message.datetime, "yyyy-mm-dd HH:MM:ss").replace(date,"");
                //отправляем готовое сообщение всем в комнате
                for(let clientId in clients){
                    if(clients[clientId].roomId === curRoomId){
                        io.to(clientId).emit("message",message);
                    }
                }
        })
    })

    socket.on('disconnect', () => {

        for(let clientId in clients){
            if(clients[clientId].roomId === clients[socket.id].roomId){
                io.to(clientId).emit("left_user", {id:clients[socket.id].userId});
            }
        }
        delete clients[socket.id];

    })
})

function emitUpdateRooms(serverId){
    for(let clientId in clients){
        if(clients[clientId].serverId == serverId){
            io.to(clientId).emit("updateRooms");

        }
    }
}

function emitUpdateUsers(roomId){
    for(let clientId in clients){
        if(clients[clientId].roomId == roomId){
            io.to(clientId).emit("updateUsers");

        }
    }
}

function emitUpdateServers(serverId){
    for(let clientId in clients){
        if(clients[clientId].serverId == serverId){
            io.to(clientId).emit("updateServers");

        }
    }
}

https1.listen(8084, "rp-ruler.ru", () =>
    console.log(`Socket listens`)
)

app.get('/rooms',query("serverId").isInt(), ValidatingFunctions.verifyFields, ValidatingFunctions.verifyToken,async function(req, res) {
    if(req.query.serverId == 0){
        db.query("SELECT room.*,user.login FROM room LEFT JOIN room_user ON room.id=room_user.room_id \n" +
            "                                                              AND room_user.user_id != ? \n" +
            "                                                              LEFT JOIN user ON user.id = room_user.user_id \n" +
            "WHERE room.server_id=0 AND room.id IN (SELECT room_id FROM room_user WHERE user_id=?)",[req.userId,req.userId],
            function (err,data) {
            res.send({rooms:data,categories:[]});
        })
    }else{
        const [rooms] = await dbP.execute("SELECT room.*,ru.is_muted FROM room LEFT JOIN (SELECT * FROM room_user WHERE user_id=?) ru \n" +
            "    ON ru.room_id = room.id WHERE server_id=? ORDER BY room.room_order",[req.userId,req.query.serverId]);
        const [unreadRooms] = await dbP.execute("SELECT room.id FROM room LEFT JOIN (SELECT * FROM room_user WHERE user_id=?) ru \n" +
            "    ON ru.room_id = room.id WHERE room.server_id=? AND (room.last_msg_id <> ru.last_read_msg_id AND ru.id IS NOT NULL)",[req.userId,req.query.serverId]);
        unreadRooms.forEach(function (unreadRoom){
            rooms.find((room) => room.id === unreadRoom.id).is_unread = 1;
        })
        const [categories] = await dbP.execute("SELECT * FROM rooms_category WHERE server_id=?",[req.query.serverId])

        res.send({rooms:rooms,categories:categories});
    }
});


app.get("/profile",function (req,res){
    db.query("SELECT id,login,email,avatar,status FROM user WHERE token=?",[req.token], function(err, data) {
        if(err != null || data.length === 0){
            res.status(403).send({"error":"invalid token"});
        }else{
            res.send({user:data[0]});
        }
    });
});

app.put("/profile",ValidatingFunctions.verifyToken,async function(req,res){
    if(req.body.login != "null"){
        let [user] = await dbP.execute("SELECT id FROM user WHERE login=?",[req.body.login]);
        if(user.length > 0){
            res.send({error:"Логин занят"});
            return;
        }
        dbP.execute("UPDATE user SET login=? WHERE id=?",[req.body.login,req.userId]);
    }
    if(req.body.status != "null"){
        dbP.execute("UPDATE user SET status=? WHERE id=?",[req.body.status,req.userId]);
    }
    if(req.body.prevPass != "null" && req.body.newPass != "null"){
        let [user] = await dbP.execute("SELECT id FROM user WHERE id=? AND password=md5(?)",[req.userId,req.body.prevPass]);
        if(user.length === 0){
            res.send({error:"Неверный текущий пароль"});
            return;
        }
        if(req.body.newPass.length < 6){
            res.send({error:"Слишком короткий пароль"});
            return;
        }
        dbP.execute("UPDATE user SET password=md5(?) WHERE id=?",[req.body.newPass,req.userId]);
    }
    let currentRoom = null;
    for(let clientId in clients){
        if(clients[clientId].userId == req.userId){
            currentRoom = clients[clientId].roomId;
            break;
        }
    }
    emitUpdateUsers(currentRoom);

    res.send({success:1});
})


app.get("/users_in_room",
    query("roomId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res) {
    let [serverId] = await dbP.execute("SELECT server_id FROM room WHERE id=?",[req.query.roomId]);
    serverId = serverId[0].server_id;

    let [users] = await dbP.execute("SELECT user.login,user.avatar,user.id,user.status,UNIX_TIMESTAMP(user.last_time_online) AS last_time_online,role.color,users_servers.role_id,role.role_order FROM user\n" +
        "    LEFT JOIN users_servers ON users_servers.user_id = user.id AND" +
        " users_servers.server_id=? LEFT JOIN role ON role.id=users_servers.role_id WHERE user.room_id=?",[serverId,req.query.roomId]);
    users = users.filter((user) => Date.now()/1000 - user.last_time_online < 180);
    res.send({users:users});
})


app.get("/users_on_server",query("serverId").isInt(),ValidatingFunctions.verifyFields,ValidatingFunctions.verifyToken,async function(req,res){
    let [users] = await dbP.execute("SELECT user.login,user.avatar,user.id,user.status,UNIX_TIMESTAMP(user.last_time_online) AS last_time_online,role.color,users_servers.role_id,role.role_order FROM users_servers\n" +
        "    LEFT JOIN user ON users_servers.user_id = user.id LEFT JOIN role ON role.id=users_servers.role_id WHERE users_servers.server_id=?",[req.query.serverId]);

    users.forEach((user) => user.online = Date.now()/1000 - user.last_time_online > 180 ? 0 : 1);

    res.send({users:users});
})

app.get("/servers_of_user",ValidatingFunctions.verifyToken,async function(req,res){
    let [servers] = await dbP.execute("SELECT server.name,server.card_bg,server.id,server.admin_id,server.avatar,server.last_msg_id,server.description,server.tags,server.is_private,server.age FROM\n" +
        "                                    users_servers AS us LEFT JOIN server ON us.server_id = server.id \n" +
        "                                    WHERE us.user_id=?",[req.userId]);
    for (const server of servers) {
        [server.roles] = await dbP.execute("SELECT * FROM role WHERE server_id=? ORDER BY role_order",[server.id]);
    }
    for (const server of servers) {
        [server.character] = await dbP.execute("SELECT * FROM role WHERE server_id=? ORDER BY role_order",[server.id]);
    }
    res.send(servers);
})

app.get("/role",query("serverId").isInt(),ValidatingFunctions.verifyFields,ValidatingFunctions.verifyToken,async function(req,res){
    let [role] = await dbP.execute("SELECT role.* FROM users_servers LEFT JOIN role ON role.id=users_servers.role_id WHERE users_servers.user_id=? AND users_servers.server_id=?"
        ,[req.userId,req.query.serverId]);
    res.send({role:role});
})

app.get("/servers",ValidatingFunctions.verifyToken,async function(req,res){
    let limit = req.query.limit ?? 40;
    let offset = req.query.offset ?? 0;
    let search = req.query.s ?? "";
    let servers;
    if(search != null && search.length > 2){
        if(search[0] === "#"){
            search = search.slice(1);
            [servers] = await dbP.execute("SELECT * FROM server WHERE tags LIKE ? ORDER BY `count` DESC LIMIT ? OFFSET ?",["%"+search+"%",limit+"",offset+""]);
        }else{
            [servers] = await dbP.execute("SELECT * FROM server WHERE name LIKE ? ORDER BY `count` DESC LIMIT ? OFFSET ?",["%"+search+"%",limit+"",offset+""]);
        }
    }else{
         [servers] = await dbP.execute("SELECT * FROM server ORDER BY `count` DESC LIMIT ? OFFSET ?",[limit+"",offset+""]);
    }
    res.send({servers:servers});
})

app.put("/role_of_user",
    body("serverId").isInt(),
    body("roleId").isInt(),
    body("userId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

})

app.get("/categories",query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){
    let [categories] = await dbP.execute("SELECT * FROM rooms_category WHERE server_id=?",[req.query.serverId]);
    res.send({categories:categories});
})


app.post("/categories",
    body("serverId").isInt(),
    body("name").isString().isLength({min:1,max:35}),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,req.body.serverId);

    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("INSERT INTO rooms_category VALUES(NULL,?,?)",[req.body.name,req.body.serverId]);
    emitUpdateRooms(req.body.serverId);
    res.send({success:1});
})

app.put("/categories",
    body("categoryId").isInt(),
    body("name").isString().isLength({min:1,max:35}),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [serverId] = await dbP.execute("SELECT server_id FROM rooms_category WHERE id=?",[req.body.categoryId]);
    serverId = serverId[0].server_id;
    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,serverId);

    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("UPDATE rooms_category SET name=? WHERE id=?",[req.body.name,req.body.categoryId]);
    emitUpdateRooms(serverId);
    res.send({success:1});
})


app.post("/rooms",
    body("serverId").isInt(),
    body("name").isString().isLength({min:1,max:35}),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){

    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,req.body.serverId);
    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("INSERT INTO room VALUES(NULL,?,?,?,?,?,NULL,NULL,0,CURRENT_TIMESTAMP,NULL,0,?)",
        [req.body.name,req.body.description,req.body.icon ?? "chat",req.body.bg ?? null,req.body.serverId,req.body.is_location]);
    emitUpdateRooms(req.body.serverId);
    res.send({success:1});
})

app.put("/change_alert",body("roomId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    await dbP.execute("UPDATE room_user SET is_muted = !is_muted WHERE user_id=? AND room_id=?;",[req.userId,req.body.roomId]);
    res.send({success:1});
})

app.get("/check_token",function (req,res){
    db.query("SELECT id FROM user WHERE token=?",[req.token], function(err, data) {
        if(err != null || data.length === 0){
            res.send({correct:0});
        }else{
            res.send({correct:1});
        }
    });
})

app.put("/connect_to_server",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [roleId] = await dbP.execute("SELECT id FROM role WHERE server_id=? ORDER BY role_order DESC LIMIT 1",[req.query.serverId]);
    roleId = roleId[0].id;

    await dbP.execute("INSERT IGNORE INTO users_servers VALUES(null,?,?,?,NULL)",[req.query.serverId,req.userId,roleId]);
    await dbP.execute("UPDATE server SET count = count + 1 WHERE id=?",[req.query.serverId]);

    const [rooms] = await dbP.execute("SELECT id,last_msg_id FROM room WHERE server_id=?",[req.query.serverId]);

    rooms.forEach((room)=>{
        dbP.execute("INSERT INTO room_user VALUES(NULL,?,?,?,0) ON DUPLICATE KEY UPDATE last_read_msg_id=?;",[room.id,req.userId,room.last_msg_id,room.last_msg_id]);
    })

    res.send({success:1});
})

app.post("/servers",
    body("name").isString().isLength({min:1,max:20}),
    body("age").isInt(),
    body("isPrivate").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
        db.query("INSERT INTO server VALUES(NULL,?,?,?,?,?,0,?,?,?,1)",
            [req.body.name,req.body.description ?? "",req.body.avatar ?? null,req.body.bg ?? null,req.body.isPrivate,req.userId,req.body.age,req.body.tags ?? ""],async function(err,data){
                let serverId = data.insertId;
                await dbP.execute("INSERT INTO role VALUES(NULL,'Админ',?,1,1,1,1,1,0,1,'red',1,1)",[serverId]);
                let [roleId] = await dbP.execute("SELECT id FROM role WHERE server_id = ?;", [serverId]);
                roleId = roleId[0].id;
                await dbP.execute("INSERT INTO users_servers VALUES(null,?,?,?,NULL)",[serverId,req.userId,roleId]);
                res.send({id:serverId});
            });

    }
)


app.delete("/users",
    ValidatingFunctions.verifyToken,
    async function (req,res){
    dbP.execute("DELETE FROM user WHERE id=?",[req.userId]);
    res.send({success:1});
})

app.delete("/categories",
    query("categoryId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){
    let [serverId] = await dbP.execute("SELECT server_id FROM rooms_category WHERE id=?",[req.query.categoryId]);
    serverId = serverId[0].server_id;

    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,serverId);
    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("DELETE FROM rooms_category WHERE id=?",[req.query.categoryId]);
    emitUpdateRooms(serverId);
    res.send({success:1});
})

app.delete("/rooms",
    query("roomId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [serverId] = await dbP.execute("SELECT server_id FROM room WHERE id=?",[req.query.roomId]);
    serverId = serverId[0].server_id;
    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,serverId);
    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("DELETE FROM room WHERE id=?",[req.query.roomId]);
    emitUpdateRooms(serverId);
    res.send({success:1});
})

app.delete("/servers",
    query("serverId"),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [servers] = await dbP.execute("SELECT id FROM server WHERE id=? AND admin_id=?",[req.query.serverId,req.userId]);
    if(servers.length === 0){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("DELETE FROM server WHERE id=? AND admin_id=?",[req.query.serverId,req.userId]);
    res.send({success:1});
})

app.put("/disconnect_from_server",
    body("serverId"),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    await dbP.execute("DELETE FROM users_servers WHERE server_id=? AND user_id=?",[req.body.serverId,req.userId]);
    await dbP.execute("UPDATE server SET count = count - 1 WHERE id=?",[req.body.serverId]);
    res.send({success:1});
})

app.put("/servers",
    body("serverId").isInt(),
    body("age").isInt(),
    body("name").isString().isLength({min:1,max:20}),
    body("roles").toArray().isArray({min:1}),
    body("roles").toArray().isArray(),
    body("isPrivate").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
        let permission = await ValidatingFunctions.checkRights("server_edit",req.userId,req.body.serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }
        dbP.execute("UPDATE server SET name=?,description=?,avatar=?,card_bg=?,is_private=?,age=?,tags=? WHERE id=?",
            [req.body.name,req.body.description ?? "",req.body.avatar ?? "",req.body.bg ?? null,req.body.isPrivate,req.body.age,req.body.tags ?? "",req.body.serverId]);

        let roles = JSON.parse(req.body.roles);
        roles.forEach((role,order)=>{
            // Добавление новой роли (т. к. id'шник был нулевой, присваивается новый)
            if(role.id == 0){
                dbP.execute("INSERT INTO role VALUES (NULL, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,0);",
                    [role.name,role.server_id,role.server_edit,role.role_edit,role.msg_send,role.msg_delete,role.room_edit,role.is_player,role.is_gm,role.color,order]);
            }
            // Обновление существующей роли
            else {
                dbP.execute("UPDATE role SET name=?, server_id=?, server_edit=?, role_edit=?, msg_send=?, msg_delete=?,room_edit=?,is_player=?,is_gm=?, color=?,role_order=? WHERE id=?;",
                    [role.name,role.server_id,role.server_edit,role.role_edit,role.msg_send,role.msg_delete,role.room_edit,role.is_player,role.is_gm,role.color,order,role.id]);
            }
        });

        //Удаление ролей
        let [oldRoles] = await dbP.execute("SELECT id FROM role WHERE server_id=?;",[req.body.serverId]);
        oldRoles.forEach((oldRole) => {
            if(roles.find((role) => role.id == oldRole.id) ==null){
                dbP.execute("DELETE FROM role WHERE id=?",[oldRole.id]);
            }
        })


        //Уровни
        /*let levels = JSON.parse(req.body.levels);
        levels.forEach((level) => {
            //Добавляем
            if(!Number.isInteger(level.id) && level.id.indexOf("new") !== -1){
                dbP.execute("INSERT INTO level VALUES(NULL,?,?,?,?,?,NULL);",[req.body.serverId,level.number,level.hp,level.mp,level.exp]);
            }else{
                //Обновляем
                dbP.execute("UPDATE level SET number=?,hp=?,mp=?,exp=? WHERE id=?",[level.number,level.hp,level.mp,level.exp,level.id]);
            }
        })*/

        //Удаляем
        /*let [oldLevels] = await dbP.execute("SELECT id FROM level WHERE server_id=?;",[req.body.serverId]);
        oldLevels.forEach((oldLevel) => {
            if(levels.find((level) => level.id == oldLevel.id) == null){
                dbP.execute("DELETE FROM level WHERE id=?",[oldLevel.id]);
            }
        })*/

        emitUpdateServers(req.body.serverId);
        res.send({success:1});


    })

app.post("/login_api",
    body("login").isString().isLength({min:1}),
    body("password").isString().isLength({min:4}),
    ValidatingFunctions.verifyFields,
    async function(req,res){
    let [user] = await dbP.execute("SELECT * FROM user WHERE (email=? OR login=?) AND password=md5(?) LIMIT 1",[req.body.login,req.body.login,req.body.password]);
    if(user.length > 0){
        const token = require('crypto').randomBytes(64).toString('hex');
        await dbP.execute("UPDATE user SET token=? WHERE (email=? OR login=?) AND password=md5(?) LIMIT 1",[token,req.body.login,req.body.login,req.body.password]);
        res.send({token:token,user_id:user[0].id,user_type:user[0].user_type});
    }else{
        res.status(403).send({error:1});
    }
})

app.post("/register_api",
    body("email").isEmail(),
    body("password").isString().isLength({min:6}),
    body("login").isString().isLength({min:1}),
    ValidatingFunctions.verifyFields,async function(req,res){
        //не занят ли логин
        let [loginCheck] = await dbP.execute("SELECT * FROM user WHERE login=?",[req.body.login]);
        if(loginCheck.length !== 0){
            res.send({error:1});
            return;
        }
        //не занят ли email
        let [emailCheck] = await dbP.execute("SELECT * FROM user WHERE email=?",[req.body.email]);
        if(emailCheck.length !== 0){
            res.send({error:2});
            return;
        }
        const token = require('crypto').randomBytes(64).toString('hex');
        await dbP.execute("INSERT INTO user VALUES(NULL,?,?,md5(?),0,null,'',?,NULL,CURRENT_TIMESTAMP,0,0);",[req.body.login,req.body.email,req.body.password,token]);
        let [userId] = await dbP.execute("SELECT LAST_INSERT_ID() as res");
        userId = userId[0].res;
        res.send({token:token,userId:userId,userType:0});

    })

app.post("/logout",ValidatingFunctions.verifyToken,function (req,res){
    dbP.execute("UPDATE user SET token=NULL WHERE token=?",[req.token]);
    res.send({success:1});
})

app.put("/rooms",
    body("roomId").isInt(),
    body("serverId").isInt(),
    body("name").isString().isLength({min:1}),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){
        let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,req.body.serverId);
        if(!permission){
            res.status(403).send({error:"access denied"});
            return;
        }
        dbP.execute("UPDATE room SET name=?,description=?,bg=?,icon=?, is_location=? WHERE id=?",
            [req.body.name,req.body.description ?? "",req.body.bg ?? "",req.body.icon ?? "chat",req.body.is_location,req.body.roomId]);
        emitUpdateRooms(req.body.serverId);
        res.send({success:1});
})

app.put("/set_category_of_room",
    body("roomId").isInt(),
    body("order").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [serverId] = await dbP.execute("SELECT server_id FROM room WHERE id=?",[req.body.roomId]);
    serverId = serverId[0].server_id;
    let categoryId = req.body.categoryId === "null" ? null : req.body.categoryId;
    let permission = await ValidatingFunctions.checkRights("room_edit",req.userId,serverId);
    if(!permission){
        res.status(403).send({error:"access denied"});
        return;
    }
    await dbP.execute("UPDATE room SET room_order=?,category_id=? WHERE id=?",[req.body.order,categoryId,req.body.roomId]);
    emitUpdateRooms(serverId);
    res.send({success:1});
})

app.get("/room_with_user",
    query("userId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [roomId] = await dbP.execute("SELECT room_id FROM room_user WHERE user_id=? AND room_id IN\n" +
        " (SELECT room_id FROM room_user WHERE user_id=?)\n" +
        "  AND room_id IN (SELECT id FROM room WHERE server_id=0)",[req.userId,req.query.userId]);

    if(roomId.length === 0){
        db.query("INSERT INTO room VALUES(NULL,'ЛС','','chat',NULL,0,NULL,0,0,CURRENT_TIMESTAMP,NULL,0);",
            {},function(err,result){
                roomId = result.insertId;
                dbP.execute("INSERT INTO room_user VALUES (NULL,?,?,0,0);",[roomId,req.userId]);
                dbP.execute("INSERT INTO room_user VALUES (NULL,?,?,0,0);",[roomId,req.query.userId]);
                res.send({roomId:roomId});
            });
    }else{
        roomId = roomId[0].room_id;
        res.send({roomId:roomId});
    }

})

app.get("/messages",query("roomId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,async function(req,res){
    const limit = req.query.limit ?? 60;
    const offset = req.query.offset ?? 0;
    let [serverId] = await dbP.execute("SELECT server_id FROM room WHERE id=?",[req.query.roomId]);
    serverId = serverId[0].server_id;
    let date = dateFormat(new Date(), "yyyy-mm-dd");
    let [messages] = await dbP.execute("SELECT * FROM (SELECT message.*,user.login,user.avatar,role.color,role.role_order FROM message JOIN user ON message.sender_id = user.id " +
        "LEFT JOIN users_servers ON users_servers.user_id = user.id AND users_servers.server_id=? LEFT JOIN role ON role.id=users_servers.role_id " +
        "WHERE message.room_id = ? AND flag != 1 ORDER BY message.`datetime` DESC LIMIT ? OFFSET ? ) t ORDER BY t.`datetime`",
        [serverId+"",req.query.roomId+"",limit+"",offset+""]);
    let [lastRead] = await dbP.execute("SELECT * FROM room_user WHERE user_id=? AND room_id=?;",[req.userId,req.query.roomId]);
    for(let i = 0; i < messages.length; i++){
        if(messages[i].reply_id != 0){
            let [replyMsg] = await dbP.execute("SELECT message.*,user.login,user.avatar,user.login FROM message JOIN user ON message.sender_id = user.id " +
                "WHERE message.id=?",[messages[i].reply_id]);
            messages[i].reply_message = replyMsg[0];
        }
        messages[i].datetime = dateFormat(messages[i].datetime, "yyyy-mm-dd HH:MM:ss").replace(date,"");

    }
    res.send({messages:messages,lastRead:lastRead});

})

app.put("/messages_read",
    body("roomId").isInt(),
    body("messageId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    dbP.execute("INSERT INTO room_user VALUES(NULL,?,?,?,0) ON DUPLICATE KEY UPDATE last_read_msg_id=?;",[req.body.roomId,req.userId,req.body.messageId,req.body.messageId]);
    res.send({success:1});
})


app.get("/roles",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
    let [role] = await dbP.execute("SELECT role.* FROM users_servers LEFT JOIN role ON role.id=users_servers.role_id WHERE users_servers.user_id=? AND users_servers.server_id=?",
        [req.userId,req.query.serverId]);
    res.send({role:role[0]});
})


app.post("/upload_avatar",
    ValidatingFunctions.verifyToken,
    async function(req,res){
        const newName = require('crypto').randomBytes(10).toString('hex') +"."+ req.files.avatar.name.split(".").pop();

        fs.rename(req.files.avatar.tempFilePath,"upload/"+newName,(err)=>{});

        //req.files.avatar.mv('./upload/' + newName);

        dbP.execute("UPDATE user SET avatar=? WHERE id=?",[newName,req.userId]);

        let currentRoom = null;
        for(let clientId in clients){
            if(clients[clientId].userId == req.userId){
                currentRoom = clients[clientId].roomId;
                break;
            }
        }
        emitUpdateUsers(currentRoom);

        res.send({avatar:newName});

})

app.post("/upload_file",
    ValidatingFunctions.verifyToken,
    async function(req,res){
        const newName = require('crypto').randomBytes(10).toString('hex') +"."+ req.files.file.name.split(".").pop();

        fs.rename(req.files.file.tempFilePath,"upload/"+newName,(err)=>{});

        res.send({filename:newName});
})

/** ========== Взаимодействие с аттрибутами персонажей на сервере ========== */

/**
 * Обновить набор аттрибутов
 * @param body.serverId - id сервера, на котором проводятся изменения
 * @param body.attributes - добавляемые и обновляемые аттрибуты
 * @param body.deletedIds - id'шники удаляемых аттрибутов
 */
app.put("/attributes",
    body("serverId").isInt(),
    body("attributes").toArray().isArray({min:1}),
    body("attributes").toArray().isArray(),
    body("deletedIds").toArray().isArray({min:1}),
    body("deletedIds").toArray().isArray(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.editAttributes
)

app.get("/profile_attributes",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.getProfileAttributes
)

app.get("/all_attributes",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.getAttributes
)

/** ========== Взаимодействие с системой опыта ========== */

/**
 * Обновить набор аттрибутов
 * @param body.serverId - id сервера, на котором проводятся изменения
 * @param body.levels - добавляемые и обновляемые уровни
 * @param body.deletedIds - id'шники удаляемых аттрибутов
 */
app.put("/levels",
    body("serverId").isInt(),
    body("levels").toArray().isArray({min:1}),
    body("levels").toArray().isArray(),
    body("deletedIds").toArray().isArray({min:1}),
    body("deletedIds").toArray().isArray(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.editLevels
)

/**
 * Получить значения всех аттрибутов по уровням
 */
app.get("/levels",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.getLevels
)

app.put("/posts_rating",
    body("serverId").isInt(),
    body("postsRating").toArray().isArray({min:1}),
    body("postsRating").toArray().isArray(),
    body("deletedIds").toArray().isArray({min:1}),
    body("deletedIds").toArray().isArray(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.editPostsRating
)

app.get("/posts_rating",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.getPostsRating
)

/** ========== Взаимодействие с игровыми персонажами ========== */

/**
 * Создание персонажа игроком (подача анкеты)
 * @param body.serverId - id сервера, на котором создаётся персонаж
 * @param body.characterName - Имя персонажа
 * @param body.date - Дата создания персонажа
 * @param body.attributes - аттрибуты со значениями персонажа
 */
app.post("/characters",
    body("serverId").isInt(),
    body("attributes").toArray().isArray({min:1}),
    body("attributes").toArray().isArray(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.addCharacter
)

/**
 * Удалить персонажа
 */
app.delete("/characters",
    query("characterId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    GameMechanics.deleteCharacter
)

app.post("/upload_character_avatar",
    ValidatingFunctions.verifyToken,
    GameMechanics.uploadCharacterAvatar
)

/**
 * Одобрить анкету персонажа
 * @param query.characterId
 */
app.put("/character_confirm",
    query("characterId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){

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
})

/**
 * Отвергнуть анкету персонажа
 * @param body.characterId
 * @param body.comment
 * @param body.date
 */
app.put("/character_reject",
    body("characterId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
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
})

app.put("/characters",
    body("name").isString().isLength({min:1}),
    body("age").isInt(),
    body("biography").isString().isLength({min:1}),
    body("temper").isString().isLength({min:1}),
    body("characterId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function(req,res){
        dbP.query("UPDATE `character` SET name=?, biography=?, temper=?, extra=?, age=? WHERE id=?;",
            [req.body.name,req.body.biography,req.body.temper,req.body.extra ?? null,req.body.age,req.body.characterId],
            async function(err,data){
                res.send({success:1});
            })
    }

)

/**
 * Получить всех персонажей (в т. ч. анкеты) с последним актуальным ответом администрации (ГМов)
 */
app.get("/characters_all",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

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
})

/**
 * Получить информацию об одном персонаже по его id
 * @param serverId - id сервера
 * @param characterId - id персонажа
 */
app.get("/character_by_id",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

    let [character] = await dbP.execute("SELECT * FROM `character` WHERE id=?;", [req.query.characterId])
    let [attributes] = await dbP.execute("SELECT `name`, `type`, short_value, long_value, isGeneral FROM characters_attributes " +
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
})

/**
 * Получить информацию об одном персонаже по id владельца
 * @param serverId - id сервера
 */
app.get("/character_by_user_id",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

    let [character] = await dbP.execute("SELECT * FROM `character` WHERE user_id=?;", [req.userId])
    let [attributes] = await dbP.execute("SELECT `name`, `type`, short_value, long_value, isGeneral FROM characters_attributes " +
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
})

app.put("/characters_comment",
    body("characterId").isInt(),
    body("comment").isString(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

    let [data] = await dbP.execute("UPDATE `character` SET comment = ? WHERE id=?",
        [req.body.comment,req.body.characterId]);
    res.send({success:1});
})

app.put("/characters_exp",
    body("characterId").isInt(),
    body("exp").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    async function (req,res){

    let [data] = await dbP.execute("UPDATE `character` SET exp = ? WHERE id=?",
        [req.body.exp,req.body.characterId]);
    res.send({success:1});
})

/** */
app.get("/exp_moder",
    query("serverId").isInt(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    ExpModer.getPosts
)

app.put("/exp_moder",
    body("serverId").isInt(),
    body("posts").toArray().isArray({min:1}),
    body("posts").toArray().isArray(),
    ValidatingFunctions.verifyFields,
    ValidatingFunctions.verifyToken,
    ExpModer.giveExpForPosts
)


app.listen(80, () => {
    console.log(`Server started, good luck`)
})

https.createServer(httpsOptions, app).listen(443);
