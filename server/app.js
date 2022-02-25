const port = 47522;const ipcPort = 47524;const polytemposerverName = "polytemposerver"const polytemposerverDevice = "Nodejs"let _verbose = false;process.argv.forEach((val) => {  if(val == '-v' || val == '--verbose') _verbose = true;});// ------------------------------------------------------// make file listconst fs = require('fs');const path = require('path');const dir = '../files';const getAllFiles = function(dirPath, arrayOfFiles) {  files = fs.readdirSync(dirPath)  arrayOfFiles = arrayOfFiles || []  files.forEach(function(file) {    if (fs.statSync(dirPath + "/" + file).isDirectory()) {      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles)    } else if(path.extname(file) == '.ptsco') {    	let relativePath = path.relative(dir, path.join(dirPath, "/", file));    	// change separator on Windows    	relativePath = relativePath.replace(new RegExp('\\' + path.sep, 'g'), '/'); 		  arrayOfFiles.push(relativePath);    }  })  return arrayOfFiles}fs.writeFile(dir+'/fileList.json', JSON.stringify(getAllFiles(dir)), err => { if(err) console.log(err) });// ------------------------------------------------------// start serverconst express = require('express');const app = express();app.use(express.static('../'));const packageJSON = require('./package.json');console.log("\n===============================\nP O L Y T E M P O   S E R V E R");console.log("v"+packageJSON.version);console.log("\nServer running at:\n");//log the ip-adress to consoleconst ipRangeCheck = require("ip-range-check");const os = require('os');const ifaces = os.networkInterfaces();Object.keys(ifaces).forEach(function (ifname) { ifaces[ifname].forEach(function (iface) {   // skip over internal (i.e. 127.0.0.1), non-ipv4, and link-local addresses   if ('IPv4' !== iface.family ||   			iface.internal !== false ||   			ipRangeCheck(iface.address,"169.254.0.0/16")) {     return;   }   console.log(iface.address+":"+port+"\n"); });});console.log("===============================\n\n");// ------------------------------------------------------// Network communicationconst net = require('net');const parseString = require('xml2js').parseString;const syncMaster = {id: '', name: '', score: ''};const io = require('socket.io')(app.listen(port));// SocketIO: polytemposerver <-> clientsconst emit = (type, data) => io.sockets.emit(type, data);const clients = {};io.sockets.on("connection", socketIO => {	if(_verbose) console.log("client has connected; id: ", socketIO.id);	let client = {};		client.socketIO = socketIO;	clients[socketIO.id] = client;			client.socket = new net.Socket();// Socket: polytemposerver <-> MASTER	client.socket.on("data", data => { 		parseString(data.slice(8).toString(), (err, result) => {			//console.log(result);			if(result['Handshake']) {			} else if(result['TimeSyncReply']) {			 	socketIO.emit("timeSyncReply", result['TimeSyncReply']['$']); 				syncMaster.score = result['TimeSyncReply']['$']['ScoreName']; 				syncMaster.name = result['TimeSyncReply']['$']['PeerName'];			} else if(result['Event']) {				if(_verbose) console.log("EVENT (remote master to "+socketIO.id+"): "+JSON.stringify(result['Event']['$']));				socketIO.emit("event", parseEvent(result['Event']['$']));			} else {				console.log(result);			}		})	});	client.socket.on("close", () => {		if(_verbose) console.log("MASTER DISCONNECTED "+client.socketIO.id);		syncMaster.id = '';	});	client.socket.on("error", err => { console.log(err) });		socketIO.on('disconnect', () => { 		if(_verbose) console.log('client has disconnected');		delete clients[socketIO.id];	});		socketIO.on("event", event => handleEvent(event, socketIO.id));	socketIO.on("timeSyncRequest", data => { timeSync(data); });});function handleEvent(event, senderID, receiverName) {	if(_verbose) console.log("EVENT ("+senderID+" to "+receiverName+"): "+JSON.stringify(event));	if(syncMaster.id == polytemposerverName) {		event.timeTag = Date.now() + maxRoundTrip + 200; // add 200ms for safety 		if(receiverName && receiverName != '*') { 			for(const key in clients) { 				if(clients[key].scoreName == receiverName || clients[key].peerName == receiverName) { 					clients[key].socketIO.emit("event", event); 				} 			} 		} else {			emit("event", event);		}	} else if(senderID && senderID != polytemposerverName) {		clients[senderID].socketIO.emit("event", event); // return event to sender	}}// ------------------------------------------------------// Synchronisationlet roundTripHistory = [];let roundTripHistoryWritePosition = -1;let maxRoundTrip = 0;function timeSync(client) {	if(syncMaster.id == '') {			// do nothing if not connected	} else if(syncMaster.id == polytemposerverName) {		// store client info		clients[client.id].scoreName = client.scoreName;		clients[client.id].peerName = client.peerName;				// calculate maximum round trip time    roundTripHistory[(++roundTripHistoryWritePosition) % 20] = parseInt(client.lastRT);    let tempMax = 0;    for (const time of roundTripHistory) {	    	if(time > tempMax) tempMax = time;    }    maxRoundTrip = tempMax;		// time sync with polytemposerver		let reply = {};		reply.Id = polytemposerverName;		reply.Timestamp = Date.now();		reply.Index = client.index;		reply.MaxRT = maxRoundTrip;		clients[client.id].socketIO.emit("timeSyncReply", reply );	} else {			// time sync with remote master		const timeSyncRequest = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><TimeSyncRequest Id="'+client.id+'" PeerName="" ScoreName="'+client.scoreName+'" Index="'+client.index+'" LastRT="'+client.lastRT+'"/>');		let l = timeSyncRequest.length;		const magic = Buffer.from([0x2c,0x9e,0xb4,0xf2,l,0x00,0x00,0x00]);		const message = Buffer.concat([magic,timeSyncRequest],timeSyncRequest.length+magic.length);		if(clients[client.id]) { 			clients[client.id]['socket'].write(message);			timeSyncRequestTimestamp = Date.now();		}	}};function parseEvent(data) {	for (const key in data) {		if(data[key].startsWith("/"))			data[key] = data[key].substring(1);		else if(data[key].startsWith("i:"))			data[key] = parseInt(data[key].substring(2));		else if(data[key].startsWith("d:"))			data[key] = parseFloat(data[key].substring(2));//     else if(data[key].startsWith("b:"))//         data[key] = data[key].substring(2) == 'true' ? true : false;//     else if(data[key].startsWith("s:"))//         data[key] = data[key].substring(2);							if(key == 'Type') {			data['type'] = data[key];			delete data[key];			}	}	return data;}// ------------------------------------------------------// Heartbeatlet lastMasteradvertise = 0;setInterval(() => {	if(Date.now() - lastMasteradvertise > 2000) { 		syncMaster.id = polytemposerverName;		syncMaster.score = polytemposerverName;		syncMaster.name = polytemposerverDevice;	} 	emit("master", syncMaster);	for(let key in clients) {		if(Object.entries(clients[key]['socket'].address()).length == 0		   && syncMaster.id != '' && syncMaster.id != polytemposerverName) {			// client should connect	 		clients[key]['socket'].connect(ipcPort, syncMaster.ip, function() {  			if(_verbose) console.log('MASTER CONNECTED '+clients[key].socketIO.id);  			clients[key].socketIO.emit("master", syncMaster);  		});  	}	}}, 1000);// ------------------------------------------------------// OSC to polytemposerverconst osc = require('node-osc');const oscServer = new osc.Server(port);oscServer.on("message", function (msg, rinfo) {	if(msg[0] == "/masteradvertise") {		syncMaster.id = msg[1];		syncMaster.ip = msg[2];		lastMasteradvertise = Date.now();	} else {		let addressPattern = msg[0].substring(1).split('/');		let receiver = addressPattern.length > 1 ? addressPattern[0] : undefined;				let event = {};				event.type = addressPattern[addressPattern.length-1];		if(msg.length == 2) {			event.value = msg[1];		} else {			for(let i = 0; i < (msg.length - 1) / 2; i++) event[msg[i*2+1]] = msg[i*2+2];		}		handleEvent(event, polytemposerverName, receiver);	}});