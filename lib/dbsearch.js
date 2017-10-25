'use strict';


var winston = require('winston');
var async = require('async');

var nconf = require.main.require('nconf');

var nbbRequire = require('./nbbRequire');

var db = nbbRequire('src/database');
var topics = nbbRequire('src/topics');
var posts = nbbRequire('src/posts');
var utils = nbbRequire('public/src/utils');
var socketAdmin = nbbRequire('src/socket.io/admin');
var batch = nbbRequire('src/batch');


var searchModule = require('./' + nconf.get('database'));

db.searchIndex = searchModule.searchIndex;
db.search = searchModule.search;
db.searchRemove = searchModule.searchRemove;

var defaultPostLimit = 500;
var defaultTopicLimit = 500;
var postLimit = defaultPostLimit;
var topicLimit = defaultTopicLimit;

var batchSize = 500;

var search = module.exports;

search.init = function(params, callback) {
	params.router.get('/admin/plugins/dbsearch', params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
	params.router.get('/api/admin/plugins/dbsearch', params.middleware.applyCSRF, renderAdmin);

	params.router.post('/api/admin/plugins/dbsearch/save', params.middleware.applyCSRF, save);
	callback();

	searchModule.createIndices();

	db.getObject('nodebb-plugin-dbsearch', function(err, data) {
		if (err) {
			return winston.error(err.error);
		}

		if (data) {
			postLimit = data.postLimit ? data.postLimit : defaultPostLimit;
			topicLimit = data.topicLimit ? data.topicLimit : defaultTopicLimit;
		}
	});
};

search.postSave = function(data, callback) {
	callback = callback || function() {};

	topics.getTopicField(data.post.tid, 'deleted', function(err, isTopicDeleted) {
		if (err) {
			return callback(err);
		}

		if (parseInt(isTopicDeleted, 10) === 1) {
			return callback();
		}

		postsSave([data.post], callback);
	});
};

search.postRestore = function(data) {
	search.postSave(data);
};

search.postEdit = function(data) {
	search.postSave(data);
};

search.postDelete = function(data, callback) {
	searchRemove('post', [data.post.pid], callback);
};

search.postMove = function(data) {
	topics.getTopicFields(data.post.tid, ['cid', 'deleted'], function(err, topic) {
		if (err) {
			return;
		}
		reIndexPids([data.post.pid], topic);
	});
};

search.topicSave = function(data, callback) {
	callback = callback || function() {};

	topicsSave([data.topic], callback);
};

search.topicRestore = function(data) {
	reIndexTids([data.topic.tid]);
};

search.topicEdit = function(data) {
	search.topicSave(data);
};

search.topicDelete = function(data) {
	var tid = data.topic.tid;
	async.parallel({
		topic: function(next) {
			searchRemove('topic', [tid], next);
		},
		mainPid: function(next) {
			topics.getTopicField(tid, 'mainPid', function(err, mainPid) {
				if (err) {
					return next(err);
				}
				searchRemove('post', [mainPid], next);
			});
		},
		posts: function(next) {
			batch.processSortedSet('tid:' + tid + ':posts', function(pids, next) {
				searchRemove('post', pids, next);
			}, {
				batch: batchSize
			}, next);
		}
	}, function(err) {
		if (err) {
			winston.error(err);
		}
	});
};

search.topicMove = function(data) {
	reIndexTids([data.tid]);
};

search.searchQuery = function(data, callback) {
	if (!data || !data.index) {
		return callback(null, []);
	}
	var limit = data.index === 'post' ? postLimit : topicLimit;
	var query = {};
	if (data.cid) {
		query.cid = data.cid.filter(Boolean);
	}
	if (data.uid) {
		query.uid = data.uid.filter(Boolean);
	}
	if (data.content) {
		query.content = data.content;
	}
	if (!Object.keys(query).length) {
		return callback(null, []);
	}
	db.search(data.index, query, limit, callback);
};

search.searchTopic = function (hookData, callback) {
	if (!hookData.term && !hookData.tid) {
		return callback(null, []);
	}

	async.waterfall([
		function (next) {
			topics.getTopicField(hookData.tid, 'cid', next);
		},
		function (cid, next) {
			search.searchQuery({
				index: 'post',
				cid: [cid],
				content: hookData.term,
			}, next);
		},
		function (pids, next) {
			posts.getPostsFields(pids, ['pid', 'tid'], next);
		},
		function (postData, next) {
			var pids = postData.filter(function (postData) {
				return postData && parseInt(postData.tid, 10) === parseInt(hookData.tid, 10);
			}).map(function (postData) {
				return postData.pid;
			});
			next(null, pids);
		},
	], callback);
};

search.reindex = function(callback) {
	async.waterfall([
		function (next) {
			db.setObject('nodebb-plugin-dbsearch', {
				topicsIndexed: 0,
				postsIndexed: 0,
				working: 1,
			}, next);
		},
		function (next) {
			async.parallel([
				function (next) {
					reIndexTopics(next);
				},
				function (next) {
					reIndexPosts(next);
				}
			], function(err) {
				next(err);
			});
		},
		function (next) {
			db.setObject('nodebb-plugin-dbsearch', {
				working: 0,
			}, next);
		},
	], callback);
};

function reIndexTopics(callback) {
	batch.processSortedSet('topics:tid', function(tids, next) {
		async.waterfall([
			function(next) {
				topics.getTopicsFields(tids, ['tid', 'title', 'uid', 'cid', 'deleted'], next);
			},
			function(topicData, next) {
				topicsSave(topicData, next);
			},
		], next);
	}, {
		batch: batchSize
	}, function(err) {
		callback(err);
	});
}

function topicsSave(topics, callback) {
	topics = topics.filter(function(topic) {
		return topic && topic.tid && parseInt(topic.deleted, 10) !== 1;
	});

	var data = topics.map(function(topicData) {
		var indexData = {};
		if (topicData.title) {
			indexData.content = topicData.title;
		}
		if (topicData.cid) {
			indexData.cid = topicData.cid;
		}
		if (topicData.uid) {
			indexData.uid = topicData.uid;
		}
		if (!Object.keys(indexData).length) {
			return null;
		}
		return indexData;
	});

	data = data.filter(Boolean);
	if (!data.length) {
		return callback();
	}

	var tids = topics.map(function(topic) {
		return topic.tid;
	});

	db.searchIndex('topic', data, tids, function (err) {
		if (err) {
			return callback(err);
		}
		db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'topicsIndexed', tids.length, callback);
	});
}

function reIndexPosts(callback) {
	batch.processSortedSet('posts:pid', function(pids, next) {
		var postData;
		async.waterfall([
			function(next) {
				posts.getPostsFields(pids, ['pid', 'content', 'uid', 'tid', 'deleted'], next);
			},
			function(_postData, next) {
				postData = _postData.filter(function(post) {
					return post && parseInt(post.deleted, 10) !== 1;
				});
				var tids = postData.map(function(post) {
					return post && post.tid;
				});
				topics.getTopicsFields(tids, ['deleted', 'cid'], next);
			},
			function(topicData, next) {
				postData.forEach(function(post, index) {
					if (post && topicData[index]) {
						post.cid = topicData[index].cid;
					}
				});
				postData = postData.filter(function(post, index) {
					return post && parseInt(topicData[index].deleted, 10) !== 1;
				});
				postsSave(postData, next);
			},
		], next);
	}, {
		batch: batchSize
	}, function(err) {
		callback(err);
	});
}

function postsSave(posts, callback) {
	posts = posts.filter(function(post) {
		return post && post.pid && parseInt(post.deleted, 10) !== 1;
	});

	var data = posts.map(function(postData) {
		var indexData = {};
		if (postData.content) {
			indexData.content = postData.content;
		}
		if (postData.cid) {
			indexData.cid = postData.cid;
		}
		if (postData.uid) {
			indexData.uid = postData.uid;
		}
		if (!Object.keys(indexData).length) {
			return null;
		}
		return indexData;
	});

	data = data.filter(Boolean);
	if (!data.length) {
		return callback();
	}
	var pids = posts.map(function(post) {
		return post.pid;
	});

	db.searchIndex('post', data, pids, function (err) {
		if (err) {
			return callback(err);
		}
		db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'postsIndexed', pids.length, callback);
	});
}

function searchRemove(key, ids, callback) {
	db.searchRemove(key, ids, function(err) {
		if (err) {
			return callback(err);
		}
		if (key === 'topic') {
			db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'topicsIndexed', -ids.length, callback);
		} else if (key === 'post') {
			db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'postsIndexed', -ids.length, callback);
		}
	});
}

function reIndexTids(tids, callback) {
	callback = callback || function() {};
	if (!Array.isArray(tids) || !tids.length) {
		return callback();
	}

	topics.getTopicsFields(tids, ['tid', 'title', 'uid', 'cid', 'deleted'], function(err, topicData) {
		if (err) {
			return callback(err);
		}

		topicData = topicData.filter(function(topic) {
			return parseInt(topic.tid, 10) && parseInt(topic.deleted, 10) !== 1;
		});
		if (!topicData.length) {
			return callback(err);
		}

		async.parallel([
			function(next) {
				topicsSave(topicData, next);
			},
			function(next) {
				async.each(topicData, function(topic, next) {
					async.parallel([
						function (next) {
							topics.getTopicField(topic.tid, 'mainPid', function(err, mainPid) {
								if (err) {
									return next(err);
								}
								reIndexPids([mainPid], topic, next);
							});
						},
						function (next) {
							batch.processSortedSet('tid:' + topic.tid + ':posts', function(pids, next) {
								reIndexPids(pids, topic, next);
							}, {
								batch: batchSize
							}, next);
						}
					], next);
				}, next);
			}
		], callback);
	});
}

function reIndexPids(pids, topic, callback) {
	callback = callback || function() {};
	if (!Array.isArray(pids) || !pids.length) {
		winston.warn('[nodebb-plugin-dbsearch] invalid-pid, skipping');
		return callback();
	}
	if (parseInt(topic.deleted) === 1) {
		return callback();
	}

	async.waterfall([
		function(next) {
			posts.getPostsFields(pids, ['pid', 'content', 'uid', 'tid', 'deleted'], next);
		},
		function(posts, next) {
			posts.forEach(function(post) {
				if (post && topic) {
					post.cid = topic.cid;
				}
			});
			postsSave(posts, next);
		}
	], callback);
}

function renderAdmin(req, res, next) {
	var results;
	async.waterfall([
		function (next) {
			getGlobalAndPluginData(next);
		},
		function (_results, next) {
			results = _results;
			getProgress(results, next);
		},
		function (progress) {
			results.plugin.progressData = progress;
			results.plugin.csrf = req.csrfToken();
			res.render('admin/plugins/dbsearch', results.plugin);
		},
	], next);
}

function save(req, res, next) {
	if (utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
		var data = {
			postLimit: req.body.postLimit,
			topicLimit: req.body.topicLimit
		};

		db.setObject('nodebb-plugin-dbsearch', data, function(err) {
			if (err) {
				return next(err);
			}

			postLimit = data.postLimit;
			topicLimit = data.topicLimit;

			res.json('Settings saved!');
		});
	}
}

socketAdmin.plugins.dbsearch = {};
socketAdmin.plugins.dbsearch.checkProgress = function(socket, data, callback) {
	async.waterfall([
		function (next) {
			getGlobalAndPluginData(next);
		},
		function (results, next) {
			getProgress(results, next);
		},
	], callback);
};

function getGlobalAndPluginData(callback) {
	async.parallel({
		global: function(next) {
			db.getObjectFields('global', ['topicCount', 'postCount'], next);
		},
		plugin: function (next) {
			db.getObject('nodebb-plugin-dbsearch', next);
		},
	}, function (err, results) {
		if (err) {
			return callback(err);
		}
		if (!results.plugin) {
			results.plugin = {
				topicLimit: defaultTopicLimit,
				postLimit: defaultPostLimit,
				topicsIndexed: 0,
				postsIndexed: 0,
				working: 0,
			};
		}
		results.plugin.topicCount = results.global.topicCount;
		results.plugin.postCount = results.global.postCount;
		callback(null, results);
	});
}

function getProgress(results, callback) {
	var topicsPercent = results.global.topicCount ? (results.plugin.topicsIndexed / results.global.topicCount) * 100 : 0;
	var postsPercent = results.global.postCount ? (results.plugin.postsIndexed / results.global.postCount) * 100 : 0;
	var progressData = {
		topicsPercent: Math.max(0, Math.min(100, topicsPercent.toFixed(2))),
		postsPercent: Math.max(0, Math.min(100, postsPercent.toFixed(2))),
		topicsIndexed: topicsPercent >= 100 ? results.global.topicCount : Math.max(0, results.plugin.topicsIndexed),
		postsIndexed: postsPercent >= 100 ? results.global.postCount : Math.max(0, results.plugin.postsIndexed),
		working: results.plugin.working,
	};
	setImmediate(callback, null, progressData);
}

socketAdmin.plugins.dbsearch.reindex = function(socket, data, callback) {
	search.reindex(function (err) {
		if (err) {
			winston.error(err);
		}
	});

	callback();
};

socketAdmin.plugins.dbsearch.clearIndex = function(socket, data, callback) {
	async.waterfall([
		function (next) {
			db.setObject('nodebb-plugin-dbsearch', {
				working: 1,
			}, next);
		},
		function (next) {
			async.parallel([
				function (next) {
					clearSet('topics:tid', 'topic', next);
				},
				function (next) {
					clearSet('posts:pid', 'post', next);
				}
			], function(err) {
				next(err);
			});
		},
		function (next) {
			db.setObject('nodebb-plugin-dbsearch', {
				postsIndexed: 0,
				topicsIndexed: 0,
				working: 0,
			}, next);
		},
	], function (err) {
		if (err) {
			winston.error(err);
		}
	});
	callback();
};

function clearSet(set, key, callback) {
	batch.processSortedSet(set, function(ids, next) {
		searchRemove(key, ids, next);
	}, {
		batch: batchSize
	}, callback);
}

var admin = {};
admin.menu = function(custom_header, callback) {
	custom_header.plugins.push({
		route: '/plugins/dbsearch',
		icon: 'fa-search',
		name: 'DB Search'
	});

	callback(null, custom_header);
};

search.admin = admin;
