"use strict";
String.prototype.splice = function(i,c,a){
	return this.slice(0,i)+(a||'')+this.slice(i+c);
};
var fs = require('fs'),
	deasync = require('deasync'),
	// cache = require('redis'),
	// socket = require('socekt.io'),
	crypto = require('crypto'),
	qs = require('querystring'),
	ffmpeg = require('fluent-ffmpeg'),
	encoder = new require('node-html-encoder').Encoder('entity'),
	easyimg = require('easyimage'),
	yml = {read: require('read-yaml'), write: require('write-yaml')},
	// pgp = require('pg-promise')(GLOBAL.pgp),
	// db = pgp(GLOBAL.cfg.database),
	reeeee = {
		imgur: /^https:\/\/(?:i\.)?imgur\.com\/[^/.]+\.(?:jpg|png|gif)+/i
		,youtube: [
			/^https?:\/\/(?:www\.)?youtube\.com\/watch/i,
			/^https?:\/\/youtu\.be/i
		],
		//dailymotion:
		
	},
	
	_ = {};
	
_.exists = function(path){
	try {
		fs.statSync(path);
		return true;
	} catch (e) { return false; }
};

_.mkdir = function(path){
	if (_.exists(path)) return;
	let i=-1, dirs = path.split('/');
	while (++i < dirs.length) {
		if (dirs[i] == '' || dirs[i] == '.' || dirs[i] == '..') {
			dirs.splice(i--,1);
			continue;
		}
		let p = './'+dirs.slice(0,i+1).join('/');
		try { fs.statSync(p); } 
		catch (e) { fs.mkdirSync(p); }
	}
};
	
_.toInterval = function(seconds,mode){
	let s = seconds%60;
	let m = (seconds>=60?Math.round(seconds/60):null);
	let h = (m&&m>=60?Math.round(seconds/60/60):null);
	let d = (h&&h>=24?Math.round(seconds/60/60/24):null);
	switch(mode){
		case 1:
			return (h!==null?h+'h ':'')+(m!==null?(m%60)+'m ':'')+s+'s '; // eg. 5h 12m 42s
		case 2:
			return (h!==null?h:'')+':'+(m===null?'00':(m=m%60)>9?m:'0'+m)+':'+(s>9?s:'0'+s); // eg. 5:12:42
		default:
			return (d!==null?d+' days ago':d) // eg. 4 days ago
			||	   (h!==null?h+' hours ago':h) // eg. 12 hours ago
			||	   (m!==null?m+' minutes ago':m) // eg. 32 minutes ago
			||	   'Just Now'; // anything less than a minute
	}
};

_.urldigest = function(url,decode){
	let r,s,t,p = {
		protocol:'', hash:'', port: 80,
		domain:[], domainstring:'',
		uri:[], uristring:'',
		query:{}, querystring:''
	};
	t = url;
	if (t.split('://',1)[0]) {
		t = t.split('://');
		p.protocol = t.shift();
		t = t.join('://');
	}
	if (t.split('/',1)[0]) {
		t = t.split('/');
		p.domainstring = t.shift();
		if (p.domainstring.indexOf(':') > 0){
			let x = p.domainstring.split(':');
			p.port = parseInt(x.pop());
			p.domainstring = x.pop();
		}
		p.domain = p.domain.split('.');
		t = t.join('/');
	}
	if (t.split('?',1)[0]) {
		t = t.split('?');
		if (decode){
			p.uristring = decodeUriComponent(t.shift());
			p.uristring.split('/').forEach((item)=>{p.uri.push(decodeUriComponent(item));});
		} else {
			p.uristring = t.shift();
			p.uri = p.uristring.split('/');
		}
		t = t.join('?');
	}
	if (t.split('#',1)[0]){
		t = t.split('#');
		p.querystring = t.shift();
		s = p.querystring.split('&');
		s.forEach((item)=>{
			if (!item) return;
			r = item.split('=');
			if (decode) p.query[r.shift()] = decodeUriComponent(r.join('='));
			else p.query[r.shift()] = r.join('=');
		});
		t = t.join('#');
	}
	if (t) p.hash = t;
	return p;
};
	
function parseExternalMedia(url) {
	let m=null,done,key,val,found,r={meta:{}};
	for(key in reeeee) {
		if (reeeee[key] instanceof Array){
			for (val of reeeee[key])
				if (url.test(reeeee[key])){
					found = key;
					break;
				}
			if (found) break;
		} else if (url.test(reeeee[key])){
			found = key;
			break;
		}
	}
	let err = new Error(url.substr(0,64)+(url.length>64?'[...]':'')+' did not match any supported embeds.')
	if (!found) return err;
	m = _.urldigest(url);
	r.processed = true; // External media do not need to generate thumbnails
	let id = 'temp';
	switch (found) { // meta: title size duration dims
		// case 'vocaroo':
		// case 'twitch':
		// case 'livestream':
		// case 'hitbox':
		// case 'ustream':
		case 'imgur':
			if (!m.uri[0]) return err;
			id = m.uri[0].split('.')[0];
			r.mediatype = 'img';
			r.src = 'https://i.imgur.com/'+m.uri[0];
			r.thumb = 'https://i.imgur.com/'+id+'s.jpg';
			r.hash = crypto.createHash('md5').update(found+'&'+id).digest('hex');
			r.meta.title = m.uri[0];
			r.processed = true;
			break;
		case 'youtube':
			id = m.domain=='youtu.be'?m.uri[0]:m.query.v;
			if (!id) return err;
			r.mediatype = 'you';
			r.src = 'https://www.youtube.com/embed/'+id+'?vq=large&rel=0';
			if (m.query.t) r.src += '&t='+m.query.t;
			else {
				if (m.query.start) r.src += '&start='+m.query.start;
				if (m.query.end) r.src += '&end='+m.query.end;
			}
			r.thumb = 'https://img.youtube.com/vi/'+id+'/mqdefault.jpg'
			r.hash = crypto.createHash('md5').update(found+'&'+id).digest('hex');
			r.meta.link = 'https://youtu.be/'+id;
			done = false;
			request({url:'https://youtube.com/get_video_info?video_id='+id,timeout:5},(err,req,res)=>{
				if (err) {
					r.meta.title = 'Youtube Video';
					done = true;
					return;
				}
				let data = querystring.parse(res);
				r.meta.title = data.title;
				r.meta.duration = _.toInterval(data.length_seconds,2);
				done = true;
				return;
			});
			while (!done) deasync.runLoopOnce();
			break;
		case 'dailymotion':
			id = m.uri[0]=='video'?m.uri[1].split('_')[0]:m.uri[0];
			if (!id) return err;
			r.mediatype = 'dly';
			r.src = '//www.dailymotion.com/embed/video/'+id+'?quality=480&sharing-enable=false&endscreen-enable=false';
			if (m.query.start) r.src += '&start='+m.query.start;
			r.hash = crypto.createHash('md5').update(found+'&'+id).digest('hex');
			done = false;
			request({url:'//api.dailymotion.com/video/'+id+'?fields=title,thumbnail_120_url,tiny_url,duration',timeout:5},(err,req,res)=>{
				if (err) {
					if (!(r.meta.title = m.uri[1].split('_')[1]))
						r.meta.title = 'Dailymotion Video';
					done = true
					return;
				}
				let data = querystring.parse(res);
				r.thumb = data.thumbnail_120_url;
				r.meta.title = data.title;
				r.meta.link = data.tiny_url;
				r.meta.duration = _.toInterval(data.duration,2);
				done = true;
				return;
			});
			while (!done) deasync.runLoopOnce();
			break;
	}
	return r;
};

function parseInternalMedia(file,board,trackfiles) { // src hash thumb meta mediatype nsfw
	let r={meta:{}};
	switch (file.mimetype.toLowerCase()) { // meta: title size duration dims link
		case 'image/jpg':
		case 'image/jpeg':
		case 'image/jpe':
		case 'image/png':
			try {
				r.mediatype = 'img';
				r.meta.title = file.originalname;
				file.path = file.path.replace(/\\/g,'/');
				let fn = file.path.split('/')[file.path.split('/').length-1];
				r.src = '/'+board+'/media/'+fn;
				r.thumb = '/'+board+'/media/'+fn+'.thumb.jpg';
				fs.renameSync(__dirname+'/'+file.path,__dirname+'/assets'+r.src);
				trackfiles.push('/assets'+r.src);
				r.hash = crypto.createHash('md5').update(fs.readFileSync(__dirname+'/assets'+r.src, 'utf8')).digest('hex');
				let done = false;
				easyimg.info(__dirname+'/assets'+r.src).then((file)=>{
					console.log('large',file);
					r.meta.dims = file.width+'x'+file.height;
					easyimg.resize({src:__dirname+'/assets'+r.src, dst:__dirname+'/assets'+r.thumb, quality:50, width:300, height:300}).then((file)=>{
						console.log('thumb',file);
						trackfiles.push('/assets'+r.thumb);
						done = true;
					}).catch((err)=>{
						r = err;
						done = true;
					});
				}).catch((err)=>{
					r = err;
					done = true;
				});
				while (!done) deasync.runLoopOnce();
			} catch(err) {
				return err.setstatus(500);
			}
			
			break;
		case 'image/gif':
			r.mediatype = 'img';
			
			break;
		case 'audio/ogg':
			r.mediatype = 'aud';
			
			break;
		case 'audio/mpeg':
			r.mediatype = 'aud';
			
			break;
		case 'video/webm':
			r.mediatype = 'vid';
			
			break;
		case 'video/mp4':
			r.mediatype = 'vid';
			//check codec for H.264 and AAC allowed only
			
			break;
		default:
			let err = 'Unsupported media type: '+ file.mimetype.toLowerCase() +' - '+ file.originalName;
			return (new Error(err)).setstatus(415)
	}
	return r;
};
	
_.processPostMedia = function(board,body,files,trackfiles) {
	this.mkdir('./assets/'+board.board+'/media');
	let i = -1, media = [], f;
	while (++i < board.mediauploadlimit) {
		if (body['media'+i]) {
			let m = parseExternalMedia(body['media'+i]);
			if (m instanceof Error) return m;
			m.nsfw = !!body['spoiler_media'+i];
			media.push(m);
		} else if (files && (f = files.filter((cur)=>{return cur.fieldname == 'media'+i;})).length) {
			let m = parseInternalMedia(f[0],board.board,trackfiles);
			if (m instanceof Error) return m;
			m.nsfw = !!body['spoiler_media'+i];
			media.push(m);
		}
	}
	return media;
};

_.posterID = function(ip,board,thread){
	let trip = crypto.createHash('sha1')
		.update(ip)
		.update(board)
		.update(thread.toString())
		.update(GLOBAL.cfg.secret)
		.digest();
	return crypto.createHash('sha1')
		.update(trip)
		.update(GLOBAL.cfg.secret)
		.digest()
		.toString('hex')
		.substr(0,GLOBAL.cfg.values.poster_id_length);
};

_.processTrip = function(trip,capcode){
	if (trip === null) return null;
	let t = trip;
	if (trip.indexOf('#') == 0) {
		let trip = t;
		trip = trip.substr(1);
		let i = -1;
		if (capcode && GLOBAL.cfg.capcodes) 
			while (++i < GLOBAL.cfg.capcodes){
				if (trip.trim().toLowerCase() == capcode.toLowerCase()){
					return ' ## '+capcode;
				}
			}
		if (GLOBAL.cfg.custom_tripcodes && '##'+trip in GLOBAL.cfg.custom_tripcodes)
			return '!!'+GLOBAL.cfg.custom_tripcodes['##'+trip];
		// if not a known capcode or custom trip, process as a secure trip
		trip = crypto.createHash('sha256')
			.update('paranoid_normie')
			.update(trip)
			.update(GLOBAL.cfg.secret)
			.digest();
		return '!!'+ crypto.createHash('sha1')
			.update(trip)
			.update(GLOBAL.cfg.secret)
			.digest()
			.toString('base64')
			.substr(0,10);
	} else {
		let trip = t;
		if (GLOBAL.cfg.custom_tripcodes && '#'+trip in GLOBAL.cfg.custom_tripcodes)
			return '!'+GLOBAL.cfg.custom_tripcodes['#'+trip];
		// process as an unsecure trip
		trip = crypto.createHash('sha256')
			.update('normie')
			.update(trip)
			.digest();
		return '!'+crypto.createHash('sha1')
			.update(trip)
			.digest()
			.toString('base64')
			.substr(0,10);
	}
};

_.processMarkdown = function(req,res,next){
	// implement filters with PCRE based regex for faster processing
	return req.body.markdown; // placeholder
	let cursor = 0;
	
	
};

_.processMarkup = function(markdown){
	if (!GLOBAL.cfg.markdown)
		return encoder.encodeHTML(markdown)
			.replace(new RegExp("&#13;",'g'),'')
			.replace(new RegExp("&#10;",'g'),'<br>');
	let keys = GLOBAL.cfg.markdown.custom, suppress = GLOBAL.cfg.markdown.suppress||null, list = GLOBAL.cfg.markdown.list||{},
		markup = markdown.replace(new RegExp("\r",'g'),''), depth = [], track = [], cursor = 0, currentlist;
	if (suppress && markup.substr(0,suppress.all.length) == suppress.all)
		return encoder.htmlEncode(markup.slice(suppress.all.length))
			.replace(new RegExp("&#13;",'g'),'')
			.replace(new RegExp("&#10;",'g'),'<br>');
	keys.forEach((item)=>{
		item.before = item.brick?'['+item.key+']':item.key;
		item.after = item.brick?'[/'+item.key+']':item.key;
		item.start = [];
	});
	list.forEach((item)=>{item.exclusiveline = true;});
	while (1){
		let e = depth[depth.length-1];
		if (!(e&&e.exclusivetext) && suppress && markup.substr(cursor,suppress.paragraph.length) == suppress.paragraph){
			// confirm newline placement
			if (cursor == 0 || markup.substr(cursor-1,1)=="\n"){
				let i = 0, c = 0;
				while (++i <= depth.length){
					if (depth[depth.length-i].exclusiveline){
						depth.splice(depth.length-i,1);
						continue;
					}
				}
				let hold = cursor;
				markup = markup.splice(cursor,suppress.paragraph.length);
				while (markup.slice(cursor,++cursor) != "\n") if (cursor >= markup.length) break;
				
				// close depths
				i=0;
				while (++i <= depth.length){
					let t = depth[depth.length-i];
					// prevent unnecessary empty nodes from being generated
					if (markup.substr(cursor-t.before.length,t.before.length) == t.before) {
						markup = markup.splice(cursor-t.before.length,t.before.length);
						cursor -= t.before.length;
						depth[depth.length-i].start.pop();
						depth.splice(depth.length-i,1);
						i=0;
						continue;
					}
				}
				i = 0;
				while (++i <= depth.length){
					// make sure there is a closing markup for each depth
					if (depth[depth.length-i].after&&markup.slice(cursor).indexOf(depth[depth.length-i].after) === -1){
						depth.splice(depth.length-i--,1);
						continue;
					}
					let t = depth[depth.length-i], k = keys.indexOf(t),
						a = "\r"+k+"!\r", b = "\r!"+k+"\r";
					markup = markup.splice(t.start[t.start.length-1],t.before.length,b);
					hold = hold - t.before.length + b.length;
					cursor = cursor - t.before.length + b.length;
					markup = markup.splice(hold-1,0,a);
					c += a.length;
					hold += a.length;
					t.start.pop();
					track.push(t);
				}
				cursor += c;
				// reopen depths in original order if not at the end of the markdown
				if (cursor < markup.length) {
					i=0;
					while (++i <= depth.length){
						// prevent unnecessary empty nodes from being generated
						let t = depth[depth.length-i];
						if (markup.substr(cursor,t.after.length) == t.after) {
							markup = markup.splice(cursor,t.after.length);
							t.start.pop();
							depth.splice(depth.length-i,1);
							i=0;
							continue;
						}
					}
					i = -1;
					while (++i < depth.length){
						if (markup.slice(cursor).indexOf(depth[i].after) == -1) continue;
						if (depth[i].exclusiveline && markup.slice(cursor).indexOf(depth[i].after+"\n") == -1) continue;
						depth[i].start.push(cursor);
						markup = markup.splice(cursor,0,depth[i].before);
						cursor += depth[i].before.length;
					}
				} else break;
			}
		}
		if (!(e&&e.exclusivetext) && suppress && markup.substr(cursor,suppress.open.length) == suppress.open){
			// check for the suppression close key first.
			if (markup.slice(cursor+suppress.open.length).indexOf(suppress.close) != -1){
				// close depths
				let i = 0, c = 0;
				while (++i <= depth.length){
					let t = depth[depth.length-i];
					// prevent unnecessary empty nodes from being generated
					if (markup.substr(cursor-t.before.length,t.before.length+t.after.length) == t.before+t.after) {
						markup = markup.splice(cursor-t.before.length,t.before.length+t.after.length);
						cursor -= t.before.length;
						t.start.pop();
						depth.splice(depth.length-i,1);
						continue;
					}
					else if (markup.substr(cursor-t.before.length,t.before.length) == t.before){
						markup = markup.splice(cursor-t.before.length,t.before.length);
						cursor -= t.before.length;
						// t.start.pop();
						// depth.splice(depth.length-i,1);
						continue;
					}
				}
				i = 0;
				while (++i <= depth.length){
					let t = depth[depth.length-i];
					// make sure there is a closing markup for each depth
					if (markup.slice(cursor+suppress.open.length).indexOf(t.after) == -1){
						t.start.pop();
						depth.splice(depth.length-i--,1);
						continue;
					} 
					else if (t.exclusiveline){
						t.start.pop();
						depth.splice(depth.length-i--,1);
						continue;
					}
					let k = keys.indexOf(t),a = "\r"+k+"!\r", b = "\r!"+k+"\r";
					markup = markup.splice(t.start[t.start.length-1],t.before.length,b);
					cursor = cursor - t.before.length + b.length;
					markup = markup.splice(cursor,0,a);
					cursor += a.length;
					t.start.pop();
					track.push(t);
				}
				// remove suppression markup
				let hold = cursor--;
				while (markup.substr(++cursor,suppress.close.length) != suppress.close)
					if (cursor >= markup.length) break;
				if (cursor < markup.length){
					markup = markup.splice(cursor,suppress.close.length);
					markup = markup.splice(hold,suppress.open.length);
					cursor -= suppress.open.length;
				}
				// reopen depths in original order
				i=0;
				while (++i <= depth.length){
					// prevent unnecessary empty nodes from being generated
					let t = depth[depth.length-i];
					if (markup.substr(cursor,t.after.length) == t.after) {
						markup = markup.splice(cursor,t.after.length);
						t.start.pop();
						depth.splice(depth.length-i,1);
						continue;
					}
				}
				i = -1;
				while (++i < depth.length){
					if (markup.slice(cursor).indexOf(depth[i].after) == -1) continue;
					if (depth[i].exclusiveline && markup.slice(cursor).indexOf(depth[i].after+"\n") == -1) continue;
					depth[i].start.push(cursor);
					markup = markup.splice(cursor,0,depth[i].before);
					cursor += depth[i].before.length;
				}
			}
		}
		if (e && e.exclusivetext && e.after && markup.substr(cursor,e.after.length) == e.after){
			let k = keys.indexOf(e), a = "\r"+k+"!\r", b = "\r!"+k+"\r";
			markup = markup.splice(e.start[e.start.length-1],e.before.length,b);
			cursor = cursor - e.before.length + b.length;
			markup = markup.splice(cursor,e.after.length,a);
			cursor = cursor + a.length;
			e.start.pop();
			track.push(e);
			depth.pop();
			continue;
		}
		let i = -1, skip = true;
		while (++i < keys.length){
			let t = keys[i];
			if (t.after && depth.indexOf(t) != -1 && markup.substr(cursor,t.after.length) == t.after) {
				if (t.exclusiveline && markup.substr(cursor+t.after.length,1) != "\n" && cursor+t.after.length < markup.length) continue;
				// insert the text bookmarks for the opening and closing of the markdown
				if (markup.substr(cursor-t.before.length,t.before.length) == t.before) {
					// prevent unnecessary empty nodes from being generated
					markup = markup.splice(cursor-t.before.length,t.before.length+t.after.length);
					cursor -= t.before.length;
					t.start.pop();
					depth.splice(depth.lastIndexOf(t),1);
					continue;
				}
				let a = "\r"+i+"!\r", b = "\r!"+i+"\r";
				markup = markup.splice(t.start[t.start.length-1],t.before.length,b);
				cursor = cursor - t.before.length + b.length;
				markup = markup.splice(cursor,t.after.length,a);
				cursor = cursor + a.length;
				depth.splice(depth.lastIndexOf(t));
				t.start.pop();
				track.push(t);
				skip = false;
				break;
			} else if (markup.substr(cursor,t.before.length) == t.before && markup.substr(cursor,t.before.length+t.after.legnth) != t.before+t.after) {
				// Bookmark the index of the markdown opening
				if (t.exclusiveline && cursor != 0 && markup.substr(cursor-1,1) != "\n") continue;
				t.start.push(cursor);
				depth.push(t);
				cursor += t.before.length;
				if (t.exclusiveline) {
					// exclusiveline will automatically close at a newline or end of text if not already.
					// does not actually consume text, only predicts that it's closing value is present.
					let hold = cursor--;
					while (markup.substr(++cursor,1) != "\n" && markup.substr(cursor,t.after.length) != t.after)
						if (cursor >= markup.length) 
							break;
					if (markup.substr(cursor,t.after.length) != t.after || cursor >= markup.length)
						markup = markup.splice(cursor,0,t.after);
					cursor = hold;
				}
				if (t.exclusivetext){
					// exclusivetext ignores all markdown (including suppression) until its closing text
					let hold = cursor--;
					while (markup.substr(++cursor,t.after.length) != t.after){
						if (cursor >= markup.length) {
							cursor = hold;
							depth.pop();
							t.start.pop();
							break;
						}
					}
				}
				skip = false;
				break;
			}
		}
		if (list){
		for (i in list) {
			let a = "\r"+i+"!\r", b = "\r!"+i+"\r";
			if (markup.substr(cursor-1,list[i].length+1) == "\n"+list[i]){
				if (currentlist != i){
					// close existing list and open new one
					
					
					currentlist = i;
					
				} else if (!currentlist){
					// open new list
					currentlist = i;
					
				} else {
					// close depths, close list item, open list item, open depths

				}
			} else if (currentlist && markup.substr(cursor-1,1) == "\n"){
				// close depths then existing list
				
				
				currentlist = null;
			}
		}}
		if (skip) cursor++;
		if (cursor > markup.length) break;
	}
	// \r (aka &#13;) is the only character that is guarenteed not to be present before and after processing
	// because we remove all instances at the start of the processing, so we use that for bookmarking the
	// keys to allow for html sensitive characters to be used in markdown without accidental encoding errors.
	// Also prevents malicious html code from leaking through.
	let i = -1;
	markup = encoder.htmlEncode(markup.replace(/^[\n\t ]+|\n+$/g,''));
	while (++i < track.length) {
		let k = keys.indexOf(track[i]);
		markup = markup
			.replace(new RegExp("&#13;!"+k+"&#13;",'g'),track[i].open)
			.replace(new RegExp("&#13;"+k+"!&#13;",'g'),track[i].close);
	}
	// replace \n (aka &#10;) with <br> nodes
	return markup.replace(new RegExp("&#10;",'g'),'<br>');
};

_.log = function(level,detail){
	console.log(level,detail);
	return;
	db.none(GLOBAL.sql.modify.new_log,{
		board: this.params.board||'_',
		user: this.locals.user.reg&&this.locals.board.loguser?this.locals.user.username:null,
		level: level,
		detail: detail.toString()
	}).catch((err)=>{
		console.log('LOGGING ERROR: ',err);
	});
};

_.getTagCloud = function(){
	return []; //placeholder
	// db.any(GLOBAL.sql.view.tags)
};

_.maskIP = function(ip){
	let cipher = crypto.createCipher('bf-cbc',GLOBAL.cfg.secret);
	let mask = cipher.update(ip,'utf8','hex');
	return mask + cipher.final('hex');
};
_.unmaskIP = function(mask){
	let decipher = crypto.createDecipher('bf-cbc',GLOBAL.cfg.secret);
	let data = decipher.update(mask,'hex','utf8');
	return data + decipher.final('utf8');
};

_.genCSRF = function(ip,path){
	return crypto.createHash('sha256')
		.update(GLOBAL.cfg.secret)
		.update(ip)
		.update(path)
		.digest('hex');
};

function User(data,board,ip){
	let anon = {
		id: null
		,verified: false
		,global: false
		,username: null
		,email:null
		,screenname: null
		,roles:{}
	};
	for (var i in anon){
		if (data&&i in data) this[i] = data[i];
		else this[i] = anon[i];
	}
	// fix the returned value from the DB call
	if (this.roles instanceof Array) {
		let roles = {};
		this.roles.forEach((item)=>{
			roles[item.board] = {
				role:item.role,
				capcode:item.capcode,
				flags:item.flags
			};
		});
		this.roles = roles;
	}
	if (this.roles == null) this.roles = {};
	this.ip = ip;
	this.currentBoard = board||'';
	this.reg = data?true:false;
};
User.prototype.auth = function(flag,def,ault){
	let board = this.currentBoard;
	if (typeof def == 'string')
		board = def, def = ault;
	let u = board in this.roles?this.roles[board]:{};
	if (u.role == 'owner') return true;
	if (this.flags == null || !this.reg) return !!def;
	if (typeof flag == 'string') flag = [flag];
	let i = -1;
	while (++i < flag.length) {
		let f = flag[i].split('.',2);
		if (f.length == 2) flag[i] = f;
		else flag[i] = ['undefined',flag[i]];
		if (GLOBAL.cfg.devmode && !(flag[i][1] in GLOBAL.flags[flag[i][0]]))
			console.log('Please define flag: '+flag[i][0]+' - '+flag[i][1]);
			GLOBAL.regflag(flag[i][0],flag[i][1]);
		if (!(flag[i][1] in u.roles[board].flags) && !('global.'+flag[i][1] in u.roles[board].flags))				
			return !!def;
		else if (!u.roles[board].flags[flag[i][1]] && !u.roles[board].flags['global.'+flag[i][1]])
			return false;
	}
	return true;
};
// User Cookie: res.cookie('user',req.session.id,{httpOnly:true,maxAge:1000*60*60*24*7});
_.User = User;

module.exports = _;