#!/usr/bin/env node

// Total hours wasted here -> 12
// ^ Do Not Remove This!

var version = '`PROJECT AKARIN VERSION 20160305`';

'use strict';


var Telegram = require('node-telegram-bot-api');
var IRC = require('irc');
var config = require('./config.js');
var pvimcn = require('./pvimcn.js');
var encoding = require('encoding');
var nickmap = require('./nickmap.js');

var tg = new Telegram(config.tg_bot_api_key, { polling: true });
var irc_c = new IRC.Client(config.irc_server, config.irc_nick, {
    channels: [config.irc_channel],
    sasl: config.irc_sasl,
    secure: config.irc_ssl,
    selfSigned: config.irc_ssl_self_signed,
    port: config.irc_port,
    username: config.irc_username,
    password: config.irc_password,
    floodProtection: true,
    floodProtectionDelay: 1000
});
var tgid, tgusername;
var enabled = true;
var blocki2t = new Array();
var blockt2i = new Array();
var msgfilter = function (s) { return s; };
var inittime = Math.round(new Date().getTime() / 1000);


function printf() {
    var str = arguments[0];
    var args = arguments;
    str = str.replace(/%(\d+)|%{(\d+)}/g, function(match, number1, number2){
	var number = number1? number1: number2;
	return (typeof args[number] != 'undefined')? args[number]: match;
    });
    return str;
}

function cutJJ() {
    var nick_to_use = config.irc_nick;
    var current_nick = irc_c.nick;
    console.log('cutjj: ' + nick_to_use + ' , ' + current_nick);
    if (current_nick != nick_to_use)
        irc_c.send('nick', nick_to_use);
}


function format_name(id, first_name, last_name) {
    var full_name = last_name?
        first_name + ' ' + last_name:
        first_name;
    var full_name_1 = nickmap.getNick(id);
    full_name_1 = full_name_1 ? full_name_1 : full_name;
    // if(full_name.length > 24)
        // full_name = full_name.slice(0, 24);
    return full_name_1;
}


function format_newline(text, user, target, type) {
    text = text.replace(/(\s*\n\s*)+/g, '\n');
    if(type == 'reply')
        text = text.replace(/\n/g, printf('\n[%1] %2: ', user, target));
    if(type == 'forward')
        text = text.replace(/\n/g, printf('\n[%1] Fwd %2: ', user, target));

    var arr = text.split('\n');
    if (arr.length > config.irc_line_count_limit ||
        arr.some(function (line){
                return line.length > config.irc_message_length_limit;
        })){

        if(config.irc_long_message_paste_enabled){
            console.log(printf('User [%1] send a long message', user));
            pvimcn.pvim(text, function cb(err, result){
                console.log('pvim result: ' + result);
                if(err)
                    irc_c.say(config.irc_channel,
                               printf('[%1] %2', user,
                                      text.replace(/\n/g, '\\n')));
                else
                    irc_c.say(config.irc_channel,
                               printf('Long Msg [%1] %2', user, result));
            });
            return null;
        }else{
            arr.map(function (line){
                return line.slice(0, config.irc_message_length_limit);
            });
            if(arr.length > config.irc_line_count_limit){
                arr = arr.slice(0, config.irc_line_count_limit);
                arr.push('(line count limit exceeded)');
            }
            text = arr.join('\n');
        }
    }

    return text.replace(/\n/g, printf('\n[%1] ', user));
}


// Event to write config on exit.
process.on('SIGINT', function (code) {
    console.log('About to exit with code:', code);
    tg.sendMessage(config.tg_group_id, '`COMMITING INTERRUPT`', { parse_mode: 'Markdown' });
    irc_c.part(config.irc_channel);
    process.exit();
});
process.on('SIGTERM', function (code) {
    console.log('About to exit with code:', code);
    tg.sendMessage(config.tg_group_id, '`COMMITING TERMINATE`', { parse_mode: 'Markdown' });
    irc_c.part(config.irc_channel);
    process.exit();
});
// End Exit Event.

// record last reply context
var lastContext = {name:'', text:'', byname:''};


irc_c.addListener('message' + config.irc_channel, function (from, message) {
    console.log(printf('From IRC %1  --  %2', from, message));

    // Blocking Enforcer
    if (blocki2t.indexOf(from) > -1 || !enabled){
        console.log('blocked');
        return;
    }



    if (message.match(/\s*\\reset\w*/)){
        resetTg();
    }

    if (message.match(/\s*\\invite/)){
        var link= config.tg_invite_link;
        var msg = 'Join the telegram group: ' + link;
        irc_c.say(config.irc_channel, msg);
        message += '\n' + msg;
    }

    if(config.other_bridge_bots.indexOf(from) == -1)
        message = printf('[%1] %2', from, message);
    // say last context to irc
    if (message.match(/\s*\\last\w*/)){
        var last_msg = printf('Replied %1: %2', lastContext.name, lastContext.text);
        irc_c.say(config.irc_channel, last_msg);
        console.log(last_msg);
        message += '\n' + last_msg;
    }

    tg.sendMessage(config.tg_group_id, message);
});


irc_c.addListener('action', function (from, to, text) {
    console.log(printf('From IRC Action %1  --  %2', from, text));

    // Blocking Enforcer
    if (blocki2t.indexOf(from) > -1 || !enabled)
        return;

    if(to == config.irc_channel){
        if(config.other_bridge_bots.indexOf(from) == -1)
            text = printf('** %1 %2 **', from, text);
        else
            text = printf('** %1 **', text);
        tg.sendMessage(config.tg_group_id, text);
    }
});


var topic="";

irc_c.addListener('topic', function (chan, newtopic, nick, message){
    topic = newtopic;
    if(nick){
        tg.sendMessage(config.tg_group_id, printf('Channel %1 has topic by %2: %3', chan, nick, topic));
    }else{
        tg.sendMessage(config.tg_group_id, printf('Channel %1 topic: %2', chan, topic));
    }
});

function sendimg(fileid, msg, type){
    tg.sendChatAction(msg.chat.id, 'upload_photo');
    tg.getFileLink(fileid).then(function (ret){
        var url = ret;
        pvimcn.imgvim(url, function(err,ret){
            console.log(ret);
            var user = format_name(msg.from.id, msg.from.first_name, msg.from.last_name);
            if (msg.caption){
                irc_c.say(config.irc_channel, printf('[%1] %2: %3 Saying: %4', user, type, ret.trim(), msg.caption));
            }else{
                irc_c.say(config.irc_channel, printf('[%1] %2: %3', user, type, ret.trim()));
            }
        });
    });
}

tg.on('message', function(msg) {
    // Process Commands.
    var me_message = false;
    console.log(printf('From ID %1  --  %2', msg.chat.id, msg.text));

    // enforce group chat
    if (msg.chat.id != config.tg_group_id) return;

    if(config.irc_photo_forwarding_enabled && msg.photo){
        var largest = {file_size: 0};
        for(var i in msg.photo){
            var p = msg.photo[i];
            if(p.file_size > largest.file_size){
                largest = p;
            }
        }
        sendimg(largest.file_id, msg, 'Img');
    } else if (config.irc_photo_forwarding_enabled && msg.sticker){
        sendimg(msg.sticker.file_id, msg, 'Sticker');
    } else if (config.irc_photo_forwarding_enabled && msg.voice){
        sendimg(msg.voice.file_id, msg, 'Voice');
    } else if (config.irc_photo_forwarding_enabled && msg.document){
        sendimg(msg.document.file_id, msg,
            printf('File(%1)', msg.document.mime_type));
    } else if (msg.text && msg.text[0] == '/') {
        var command = msg.text.split(' ');
	var arr = command[0].split('@');
	var operation = arr[0].slice(1, arr[0].length);
	if(arr.length > 2 || arr[1] != tgusername)
	    return;
	switch(operation) {
	case 'hold':
            irc_c.part(config.irc_channel);
            enabled = false;
            tg.sendMessage(msg.chat.id, "`EXECUTE ORDER STOP-FORWARD`", { parse_mode: 'Markdown' });
            return;
	    break;
	case 'unhold':
            enabled = true;
            irc_c.join(config.irc_channel);
            tg.sendMessage(msg.chat.id, '`EXECUTE ORDER START-FORWARD`', { parse_mode: 'Markdown' });
            return;
	    break;
	case 'blocki2t':
            if (command[1] && blocki2t.indexOf(command[1]) == -1) {
                blocki2t.push(command[1]);
                tg.sendMessage(msg.chat.id, '`Temporary Blocked ' + command[1] + ' From IRC to Telegram!`', { parse_mode: 'Markdown' });
            } else {
                tg.sendMessage(msg.chat.id, '`ERROR OCCURED: TARGET NOT FOUND`', { parse_mode: 'Markdown' });
            }
            return;
	    break;
	case 'blockt2i':
            if (msg.reply_to_message && blockt2i.indexOf(msg.reply_to_message.from.id) == -1) {
                blockt2i.push(msg.reply_to_message.from.id);
                tg.sendMessage(msg.chat.id, '`Temporary Blocked ' + msg.reply_to_message.from.username + ' From Telegram to IRC!`', { parse_mode: 'Markdown' });
            } else if (command[1] && !isNaN(command[1]) && blockt2i.indexOf(command[1]) == -1) {
                blockt2i.push(parseInt(command[1]));
                tg.sendMessage(msg.chat.id, '`Temporary Blocked ' + command[1] + ' From Telegram to IRC!`', { parse_mode: 'Markdown' });
            } else {
                tg.sendMessage(msg.chat.id, '`ERROR OCCURED: TARGET NOT FOUND`', { parse_mode: 'Markdown' });
            }
            return;
	    break;
	case 'unblocki2t':
            if (command[1] && blocki2t.indexOf(command[1]) > -1) {
                blocki2t.splice(blocki2t.indexOf(command[1]), 1);
                tg.sendMessage(msg.chat.id, '`Temporary Unblocked ' + command[1] + ' From IRC to Telegram!`', { parse_mode: 'Markdown' });
            } else {
                tg.sendMessage(msg.chat.id, '`ERROR OCCURED: TARGET NOT FOUND`', { parse_mode: 'Markdown' });
            }
            return;
	    break;
	case 'unblockt2i':
            if (msg.reply_to_message && blockt2i.indexOf(msg.reply_to_message.from.id) > -1) {
                blockt2i.splice(blockt2i.indexOf(msg.reply_to_message.from.id), 1);
                tg.sendMessage(msg.chat.id, '`Temporary Unblocked ' + msg.reply_to_message.from.username + ' From Telegram to IRC!`', { parse_mode: 'Markdown' });
            } else if (command[1] && !isNaN(command[1]) && blockt2i.indexOf(parseInt(command[1])) > -1) {
                blockt2i.splice(blockt2i.indexOf(parseInt(command[1])), 1);
                tg.sendMessage(msg.chat.id, 'Temporary Unblocked ' + command[1] + ' From Telegram to IRC!', { parse_mode: 'Markdown' });
            } else {
                tg.sendMessage(msg.chat.id, '`ERROR OCCURED: TARGET NOT FOUND`', { parse_mode: 'Markdown' });
            }
            return;
	    break;
	case 'reloadblocklist':
            // Load blocklist
            blocki2t = config.blocki2t;
            blockt2i = config.blockt2i;
            tg.sendMessage(msg.chat.id, '`EXECUTE ORDER BLOCKLIST-RELOAD`', { parse_mode: 'Markdown' });
            return;
	    break;
	case 'ircsay':
            var txtn;
            command.shift();
            txtn = command.join(" ");
            irc_c.say(config.irc_channel, txtn);
            return;
	    break;
	case 'ircrejoin':
            irc_c.part(config.irc_channel);
            irc_c.join(config.irc_channel);
            tg.sendMessage(msg.chat.id, '`EXECUTE ORDER REJOIN`', {parse_mode: 'Markdown'});
            return;
	    break;
	case 'cutjj':
            cutJJ();
            var cutmsg = config.use_kaomoji ? '( *・ω・)✄╰ひ╯' : '`EXECUTE ORDER TAIL-TRIM`';
            tg.sendMessage(msg.chat.id, cutmsg, { parse_mode: 'Markdown' });
            return;
	    break;
	case 'version':
            tg.sendMessage(msg.chat.id, version, { parse_mode: 'Markdown' });
            return;
	    break;
	case 'uptime':
            var uptimestr = '`PROJECT AKARIN UPTIME: ' + process.uptime() + ' seconds`\n';
            uptimestr += '`OS UPTIME: ' + require('os').uptime() + ' seconds`';
            tg.sendMessage(msg.chat.id, uptimestr, { parse_mode: 'Markdown' });
            return;
	    break;
	case 'syn':
            tg.sendMessage(msg.chat.id, '`ACK`', { parse_mode: 'Markdown' });
            return;
	    break;
	case 'blocklist':
            // Show blocklist
            tg.sendMessage(
                msg.chat.id,
                'Blocki2t: '+blocki2t+'\nBlockt2i: '+blockt2i
            );

            return;
	    break;
	case 'nick':
            // Load blocklist
	    var nick, first_name, last_name, full_name, notifymsg;
            if(command[1]){
                nick = command.slice(1).join(" ").trim();
                first_name = msg.from.first_name;
                last_name = msg.from.last_name;
                full_name = last_name?
                        first_name + ' ' + last_name:
                        first_name;
                nickmap.setNick(msg.from.id, nick);

                notifymsg = printf('User "%1" changed nick to "%2"', full_name, nick);
                tg.sendMessage(
                    msg.chat.id,
                    notifymsg
                );

                irc_c.say(config.irc_channel, notifymsg);
            }else{
                first_name = msg.from.first_name;
                last_name = msg.from.last_name;
                full_name = last_name?
                        first_name + ' ' + last_name:
                        first_name;
                nick = nickmap.getNick(msg.from.id);
                nick = nick ? nick : full_name;

                notifymsg = printf('User "%1" has nick "%2"', full_name, nick);

                tg.sendMessage(
                    msg.chat.id,
                    notifymsg
                );
            }

            return;
	    break;
	case 'topic':
            tg.sendMessage(msg.chat.id, 'Channel  topic :' + topic);
            return;
	    break;
	case 'me':
            me_message = true;
            msg.text = msg.text.substring(command[0].length);
            // passthrough to allow /me action
	    break;
	default:
            return;
        }
    }
    var user, reply_to, text, forward_from, message_text;

    // Message Filter
    if(!msg.text || msg.chat.id != config.tg_group_id || !enabled || msg.date < inittime)
        return;

    // Blocking Enforcer
    if (blockt2i.indexOf(msg.from.id) > -1 || msg.text.slice(0, 3) == '@@@')
        return;

    user = format_name(msg.from.id, msg.from.first_name, msg.from.last_name);
    if(msg.reply_to_message){
        if (msg.reply_to_message.from.id == tgid){
            if(msg.reply_to_message.text.match(/^[\[\(<]([^>\)\]\[]+)[>\)\]]/)){
                reply_to = msg.reply_to_message.text.match(/^[\[\(<]([^>\)\]\[]+)[>\)\]]/)[1];
                text = msg.reply_to_message.text.substr(reply_to.length+3);
            }else{
                reply_to = "[Nobody]";
                text = msg.reply_to_message.text;
            }
        }else{
            reply_to = format_name(msg.reply_to_message.from.id, msg.reply_to_message.from.first_name, msg.reply_to_message.from.last_name);
            text = msg.reply_to_message.text;
            text = text ? text : "Img";
        }
        lastContext = {text:text, name:reply_to, byname: user};
        message_text = format_newline(msg.text, user, reply_to, 'reply');
        if(message_text === null) return;
        message_text = printf('[%1] %2: %3', user, reply_to, message_text);
    } else if (msg.forward_from){
        if(msg.forward_from.id == tgid)
            forward_from = msg.text.match(/^[\[\(<]([^>\)\]\[]+)[>\)\]]/)[1];
        else
            forward_from = format_name(msg.forward_from.id, msg.forward_from.first_name, msg.forward_from.last_name);
        message_text = format_newline(msg.text, user, forward_from,
                                      'forward', true);
        if(message_text === null) return;
        message_text = printf('[%1] Fwd %2: %3', user, forward_from, message_text);
    } else {
        message_text = format_newline(msg.text, user);
        if(message_text === null) return;
        message_text = printf('[%1] %2', user, message_text);
    }
    if(me_message){
        irc_c.action(config.irc_channel, message_text);
    }else{
        irc_c.say(config.irc_channel, message_text);
    }
    //End of the sub process.
});

var nicks = null;

irc_c.addListener('names', function(channel, newnicks){
    nicks = newnicks;
});

tg.on('inline_query', function(msg){
    console.log(printf('inline_query: id=%1 query=%2 offset=%3', msg.id, msg.query, msg.offset));
    var user = format_name(msg.from.id, msg.from.first_name, msg.from.last_name);
    var results = [];
    var offset = msg.offset ? msg.offset : 0;

    var next_offset = offset+50 ;
    if (offset+50 < Object.keys(nicks).length)
        next_offset = "";
    var names = Object.keys(nicks).slice(offset, offset+50);

    for(var i in names){
        var key = names[i];
        results.push({
            type: 'article',
            id: msg.id + '/' + key,
            title: '' + nicks[key] + key,
            description: 'Preview: ' + key + ': ' + msg.query,
            message_text: key + ': ' + msg.query
        });
    }
    tg.answerInlineQuery(
        ''+msg.id,
        results,
        {
           cache_time: 10,
           is_personal: false,
           next_offset: next_offset
        }
    );
});

irc_c.addListener('error', function(message) {
    console.log('error: ', message);
});

irc_c.join(config.irc_channel);

function resetTg(){
    tg.sendMessage(config.tg_group_id, '`REQUESTED RESET BY USER`', { parse_mode: 'Markdown' });
    irc_c.part(config.irc_channel);
    process.exit();
}


// Load blocklist
blocki2t = config.blocki2t;
blockt2i = config.blockt2i;

// init message filter
if (typeof (config.tg_msg_filter) === 'function') {
    msgfilter = config.tg_msg_filter;
}

tg.getMe().then(function(ret){
    tgid = ret.id;
    tgusername = ret.username;
    console.log('PROJECT AKARIN INITATED');
});
irc_c.join(config.irc_channel);

var cutinv = config.cutjj_interval ? config.cutjj_interval : 5 * 60 * 1000;
var interval_cut = setInterval(cutJJ, cutinv);
