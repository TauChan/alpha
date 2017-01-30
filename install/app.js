"use strict";
var fs = require('fs'), readline = require('readline'), deasync = require('deasync'), crypto = require('crypto'),
	pgp = require('pg-promise')({ promiseLib: require('bluebird') }), cfg, yn = /^y(?:es)?/i,
	yml = {read: require('read-yaml').sync, write: require('write-yaml').sync}, process = require('process');
	
// Parse options
var opt,CLO = {s:{},l:{}};
do {
	let x=-1, targs = process.argv.slice(2);
	while (++x < targs.length){
		if (targs[x].indexOf('--') == 0){
			let y = targs[x].slice(2).split('=');
			CLO.l[y.shift()] = y.join('=')||true;
		} else if (targs[x].indexOf('-') == 0){
			let y = targs[x].slice(1).split();
			CLO.s[y] = targs[x+1]||true;
		}
	}
} while(0);
	
function prompt(question,validate,notempty) {
	var res,rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false
	});
	if (validate && !validate instanceof RegExp) validate = new RegExp(validate.toString());
	do {
		if (res !== undefined) {
			if (notempty && res === '') console.log('Input cannot be empty.');
			else console.log('Invalid input.');
			res = undefined;
		}
		rl.question(question, (input)=>{res = input;});
		while (res === undefined) deasync.runLoopOnce();
	} while ((notempty && res === '') || (validate && !validate.test(res)));
	rl.close();
	if (/^\d+$/i.test(res)) return parseInt(res);
	if (/^\d+\.\d+$/i.test(res)) return parseFloat(res);
	else return res;
}

function updatable(stale,fresh) {
	stale = stale.split('.');
	fresh = fresh.split('.');
	let i = -1, maxlength = (stale.length < fresh.length ? fresh.length : stale.length);
	while (++i < maxlength) {
		if (stale[i] === undefined) stale[i] = 0;
		if (fresh[i] === undefined) fresh[i] = 0;
		if (parseInt(fresh[i]) > parseInt(stale[i])) return true;
	}
	return false;
}

function exists(path) {
	try {
		fs.statSync(path);
		return true;
	} catch (e) {
		return false;
	}
}
function mkdir(path){
	if (exists(path)) return;
	let i=-1, dirs = path.split('/');
	while (++i < dirs.length) {
		if (dirs[i] == '' || dirs[i] == '.' || dirs[i] == '..') {
			dirs.splice(i,1);
			--i; continue;
		}
		let p = './'+dirs.slice(0,i+1).join('/');
		try { fs.statSync(p); } 
		catch (e) { fs.mkdirSync(p); }
	}
};

const dcfg = yml.read(__dirname+'/default.yml');

if (!exists(__dirname+'/../assets/_/media')) mkdir(__dirname+'/../assets/_/media');
if (!exists(__dirname+'/../cache/uploads')) mkdir(__dirname+'/../cache/uploads');
if (!exists(__dirname+'/../conf')) mkdir(__dirname+'/../conf');

if (exists(__dirname+'/../conf/config.yml')) cfg = yml.read(__dirname+'/../conf/config.yml');
else {
	console.log('Missing config. Creating file and generating new site secret value.');
	cfg = yml.read(__dirname+'/default.yml');
	cfg.secret = crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
	yml.write(__dirname+'/../conf/config.yml',cfg);
}
if ((opt = CLO.s.h || CLO.l.host) instanceof String) cfg.database.host = opt;  
if (parseInt(opt = CLO.s.p || CLO.l.port) instanceof Number) cfg.database.port = opt;  
if ((opt = CLO.s.d || CLO.l.database) instanceof String) cfg.database.database = opt;  
if ((opt = CLO.s.u || CLO.l.username) instanceof String) cfg.database.username = opt;  
if ((opt = CLO.s.p || CLO.l.password) instanceof String) cfg.database.password = opt;  
if ((opt = CLO.s.c || CLO.l.conn) instanceof String) {
	let x = opt.split("@");
	if (x.length > 1) {
		let y = x.shift().split(':');
		if (y.length > 1) cfg.database.password = y.pop();
		cfg.database.username = y.pop();
	}
	x = x[0].split('/');
	if (x.length > 1){
		cfg.database.database = x.pop();
	}
	x = x[0].split(':');
	if (x.length > 1){
		cfg.database.port = x.pop();
	}
	cfg.database.host = x.pop();
}

const VERSION = {stale: cfg.version, fresh: dcfg.version};

if (!CLO.s.q && yn.test(prompt('Configure the database connection? (y/n): '))) {
	let tdb = {};
	do {
		console.log('Please fill out the following information.  (Leave empty for existing value)');
		console.log('');
		tdb.host = tdb.host || cfg.database.host || 'localhost';
		tdb.host = prompt('hostname/address ('+tdb.host+'): ') || tdb.host;
		tdb.port = tdb.port || cfg.database.port || '5433';
		tdb.port = prompt('port number ('+tdb.port+'): ') || tdb.port;
		tdb.database = tdb.database || cfg.database.database || 'tauchan';
		tdb.database = prompt('database name ('+tdb.database+'): ') || tdb.database;
		tdb.user = tdb.user || cfg.database.user || 'tauchan';
		tdb.user = prompt('database user ('+tdb.user+'): ') || tdb.user;
		tdb.password = tdb.password || cfg.database.password || 'tauchan';
		tdb.password = prompt('database user password ('+tdb.password+'): ') || tdb.password;
		console.log('Database connection reconfigured as: '+ tdb.user+':'+tdb.password+'@'+tdb.host+':'+tdb.port+'/'+tdb.database);
	} while (!yn.test(prompt('Is this configuration correct? (y/n): ')));
	cfg.database = tdb;
	yml.write(__dirname+'/../conf/config.yml',cfg);
}

if (!cfg.database) return pgp.end(),console.log('Unable to load database configuration. Please check the config file for errors. Exiting.');

var sql = (file) => pgp.QueryFile(file,{debug: true, minify: false}),
	db = pgp(cfg.database);

if (!exists(__dirname+'/../conf/installed') || CLO.s.q || yn.test(prompt('Do you want to configure the database? (y/n): '))) {
	let versions = fs.readdirSync(__dirname+'/../install').filter((cur)=>{ 
		let c = cur.split('/'), ver = /update\.(\d+\.\d+\.\d+)\.sql$/.exec(c[c.length-1]);
		if (ver !== null) console.log(VERSION.stale,ver[1],updatable(VERSION.stale,ver[1]));
		return (ver !== null && updatable(VERSION.stale,ver[1])); 
	});
	if (exists(__dirname+'/../conf/installed') && versions.length) {
		if (CLO.s.q || yn.test(prompt('Updates are available. Would you like to update the site database? (y/n): '))) {
			let done = false;
			db.tx((self)=>{
				return self.batch(versions.map((cur)=>{return self.none(sql(__dirname+'/'+cur));}));
			}).then((data)=>{
				console.log('Success');
				done = true;
			}).catch((err)=>{
				console.log(err);
				done = null;
			});
			while (done === false) deasync.runLoopOnce();
			if (done === null) return pgp.end(),console.log('Database update failed. Exiting.');
		}
		cfg.version = VERSION.fresh;
	}
	else if (!exists(__dirname+'/../conf/installed') || !CLO.s.q || yn.test(prompt('App is already installed. Do you want to factory reset the database? (y/n): '))) {
		if (!CLO.s.q && !cfg.devmode && exists(__dirname+'/../conf/installed')) {
			console.log('These operations are destructive. Please enter the site secret from the config file to continue: ');
			if (prompt('Secret: ',/\w+/) != cfg.secret) return pgp.end(),console.log('Secret mismatch. Exiting.');
			console.log('Secret matched. Proceeding.');
		}
		
		console.log('Checking Postgres version...');
		let done = false, dbname, pgversion = false;
		db.one('SELECT version();').then((data) => {
			dbname = data.version.split(' ')[0];
			pgversion = data.version.split(',')[0].split(' ')[1];
			done = true;
		}).catch((err) => {
			console.log(err);
			done = null;
		});
		while (done === false) deasync.runLoopOnce();
		if (done === null) return pgp.end(),console.log('Postgres version check failed. Exiting.');
		if (!dbname || dbname != 'PostgreSQL') 
			return pgp.end(),console.log('Connection is not a postgres database. Please make sure you have postgres 9.5.0 or greater installed and running.');
		let pgv = pgversion.split('.');
		if (parseInt(pgv[0]) < 9 && parseInt(pgv[1]) < 5 && parseInt(pgv[2]) < 0) 
			return pgp.end(),console.log('Postgres version mismatch. Connection is running '+pgversion+', please upgrade to at least 9.5.0. Exiting.');
	
		console.log('Wiping the database...');
		done = false;
		db.none(sql(__dirname+'/wipe.sql')).then((data) => {
			console.log('Success');
			done = true;
		}).catch((err) => {
			console.log(err);
			done = null;
		});
		while (done === false) deasync.runLoopOnce();
		if (done === null) return pgp.end(),console.log('Wipe failed. Exiting.');
	
		console.log('Installing the database...');
		done = false;
		db.tx((self) => {
			return self.batch([
				self.none(sql(__dirname+'/tables.sql')),
				self.none(sql(__dirname+'/functions.sql'))
			]);
		}).then(() => {
			console.log('Success');
			done = true;
		}).catch((err) => {
			console.log(err);
			done = null;
		});
		while (done === false) deasync.runLoopOnce();
		if (done === null) return pgp.end(),console.log('Install failed. Exiting.');
		console.log('Database has been installed.');
	}
	yml.write(__dirname+'/../conf/config.yml',cfg);
}

cfg.site.name = CLO.s.q?cfg.site.name:prompt("What do you want the site's name to be? (Leave empty for existing value '"+cfg.site.name+"'): ") || cfg.site.name;

function consolidateKeys(stale,fresh) {
	for (var key in stale.options) if (fresh.options.hasOwnProperty(key)) {
		if (!stale.options.hasOwnProperty(key))
			stale.options[key] = fresh.options[key];
		else if (typeof fresh.options[key] === 'object' && !(fresh.options[key] instanceof Array))
			consolidateKeys(stale.options[key],fresh.options[key]);
	}
}
consolidateKeys(cfg,dcfg);
if (!CLO.s.q && yn.test(prompt('Do you want to configure the additional boolean options available for the app? (y/n): '))) {
	console.log('Answer the following questions with either a yes or no. (y/n is fine as well)');
	let questions = yml.read(__dirname+'/options.yml'), options = dcfg.options, missed = [];
	for (var key in options) { if (options.hasOwnProperty(key)) { 
		if (questions.hasOwnProperty(key)) {
			if (questions[key]) cfg.options[key] = yn.test(prompt(questions[key]+': ',null,true));
		} else missed.push(key);
	}}
	yml.write(__dirname+'/../conf/config.yml',cfg);
	console.log('Option configuration complete.' + (missed.length ? ' (This configuration has not covered all the available options. Please see /conf/config.yml for the full list.)':''));
}

console.log("Application installation completed. You can start the app by running 'nodejs app.js' from the app's root directory.");

pgp.end();

fs.writeFileSync(__dirname+'/../conf/installed',VERSION.fresh);
