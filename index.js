var Discord = require('discord.js');
var winston = require('winston');
var winstonDailyRotateFile = require('winston-daily-rotate-file');
var fs = require('fs');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var schedule = require('node-schedule');
var sprintf = require('sprintf').sprintf;

var auth = require('./auth.json');
// validate auth
var conf = require('./conf.json');
// validate conf
var messages = require('./messages.json');
// validate messages ?
var googleClientSecret = require('./client_secret.json');
var tokenFile = require(conf.token_file_path);

// validate requires and conf

var logger;

function startLogger() {
    var logDir = conf.log_dir;

    if (!logDir) {
        console.log('No log dir configured!');
        process.exit(1);
    } 

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }

    // sort this garbo out
    var tsFormat = () => (new Date()).toLocaleTimeString();
    logger = new (winston.Logger)({
      transports: [
        // colorize the output to the console
        new (winston.transports.Console)({
          timestamp: tsFormat,
          colorize: true,
          level: 'info'
        }),
        new (winstonDailyRotateFile)({
          filename: logDir + '/-results.log',
          timestamp: tsFormat,
          datePattern: 'yyyy-MM-dd',
          prepend: true,
          level: 'info'
        })
      ]
    });
}

startLogger();

var client;

function initialize() {
    client = new Discord.Client();
    logger.info('Logging in.');
    client.login(auth.bot_token);
}

initialize();

var checkCalendar;

client.on('ready', function () {
    logger.info('Logged in.');
    logger.info('Logging output to: ' + conf.log_dir);

    checkCalendar = schedule.scheduleJob(conf.announcement_check_configuration, function(){
        var target = client.channels.find(function(channel) {
            return channel.name === conf.announcements_channel;
        });

        if (!target) {
            // log error
            return;
        }

        // Check for next upcoming event and if there is one, print it
        target.sendMessage('TEST');
    });
});

client.on('disconnected', function () {
    logger.error('Received disconnect. Exiting.');
    process.exit(1);
});

client.on('message', function(message) {
    // Ignore messages we send to ourself
    if(message.author === client.user){
        return;
    }

    var commands = message.content.split(' ');
    var target;
    if (message.channel.type === 'text') {
        // Commands in text channels must start with an @user command
        if (!commands[0].match(auth.client_id)) {
            return;
        }

        // Remove the @obibot
        commands.shift();

        target = message.channel;
    } else if (message.channel.type === 'dm') {
        target = message.author;
    }

    if (!target) {
        logger.error('Could not find a valid target');
        logger.error(message);
        return;
    }

    // Dispatch command
    if (commands && commands.length && commands.length > 0) {
        logger.info('Got commands from: ' + message.author);
        logger.info(commands);
        return handleCommand(target, commands);
    } else {
        return;
    }
});

function handleCommand(target, commands) {
    switch (commands[0]) {
        case 'help':
            printHelp(target);
            break;
        case 'sudoku':
            sudoku(target);
            break;
        case 'upcoming':
            upcoming(target);
            break;
        default:
            // Maybe print a message about how we don't understand the command
            break;
    }

    return;
};

function printHelp(target) {
    target.sendMessage(messages.help);
}

function sudoku(target) {
    target.sendMessage('Shutting down.');
    return client.destroy();
}

function getOauth2Client() {
    var credentials = googleClientSecret;

    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    oauth2Client.credentials = tokenFile;

    return oauth2Client;
}

function upcoming(target) {
    var today = new Date();
    today.setHours(0,0,0,0);

    listEvents(getOauth2Client(), today, undefined, function(events) {
        var returnMessage = messages.upcoming.found_upcoming;
        events.forEach(function(item) {
            console.log(item);
            var start = item.start.dateTime || item.start.date;

            if (item.start && item.start.date) {
                returnMessage += sprintf(messages.upcoming.all_day, item.summary, item.start.date);
            } else if (item.start && item.start.dateTime && item.end && item.end.dateTime) {
                // split the date and times etc.
                var startDate = parseGoogleDate(item.start.dateTime);
                var endDate = parseGoogleDate(item.end.dateTime);
                console.log(startDate);
                console.log(endDate);
                returnMessage += sprintf(messages.upcoming.between, item.summary, startDate.toLocaleString(), endDate.toLocaleString());
            }
        });

        if (returnMessage) {
            target.sendMessage(returnMessage);
        } else {
            target.sendMessage(messages.upcoming.no_upcoming);
        }
    });  
}

function parseGoogleDate(date) {
    var tokens = date.split(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}):(\d{2})$/);
    var year   = +tokens[1];
    var month  = +tokens[2];
    var day    = +tokens[3];
    var hour   = +tokens[4];
    var minute = +tokens[5];
    var tzHour = +tokens[7];

    return new Date(year, month - 1, day, hour, minute);
}

function listEvents(auth, startDate, endDate, callback) {
    var calendar = google.calendar('v3');

    var calendarParameters = {
        auth: auth,
        calendarId: conf.calendar_id,
        timeMin: (new Date()).toISOString(),
        maxResults: conf.number_of_upcoming_events,
        singleEvents: true,
        orderBy: 'startTime'
    };

    if (startDate) {
        calendarParameters['timeMin'] = startDate.toISOString();
    }

    if (endDate) {
        calendarParameters['timeMax'] = endDate.toISOString();
    }

    calendar.events.list(calendarParameters, function(err, response) {
        if (err) {
            logger.error('The API returned an error: ' + err);
            return;
        }
        callback(response.items);
    });
}
