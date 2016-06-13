'use strict';

var winston = require.main.require('winston');
var async = require.main.require('async');
var db = require.main.require('./src/database');
var topics = require.main.require('./src/topics');
var posts = require.main.require('./src/posts');
var utils = require.main.require('./public/src/utils');
var socketAdmin = require.main.require('./src/socket.io/admin');
var batch = require.main.require('./src/batch');

var nconf = require.main.require('nconf');

require('./' + nconf.get('database'))(db);

(function(search) {
	var defaultPostLimit = 50;
	var defaultTopicLimit = 50;
	var postLimit = defaultPostLimit;
	var topicLimit = defaultTopicLimit;

	var batchSize = 500;

	var topicCount = 0;
	var postCount = 0;
	var topicsProcessed = 0;
	var postsProcessed = 0;

	search.init = function(params, callback) {
		params.router.get('/admin/plugins/dbsearch', params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
		params.router.get('/api/admin/plugins/dbsearch', params.middleware.applyCSRF, renderAdmin);

		params.router.post('/api/admin/plugins/dbsearch/save', params.middleware.applyCSRF, save);
		callback();

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

	search.postSave = function(postData, callback) {
		callback = callback || function() {};

		topics.getTopicField(postData.tid, 'deleted', function(err, isTopicDeleted) {
			if (err) {
				return callback(err);
			}

			if (parseInt(isTopicDeleted, 10) === 1) {
				return callback();
			}

			postsSave([postData], callback);
		});
	};

	search.postRestore = function(postData) {
		search.postSave(postData);
	};

	search.postEdit = function(postData) {
		search.postSave(postData);
	};

	search.postDelete = function(pid, callback) {
		db.searchRemove('post', [pid], callback);
	};

	search.postMove = function(data) {
		topics.getTopicFields(data.post.tid, ['cid', 'deleted'], function(err, topic) {
			if (err) {
				return;
			}
			reIndexPids([data.post.pid], topic);
		});
	};

	search.topicSave = function(topicData, callback) {
		callback = callback || function() {};

		topicsSave([topicData], callback);
	};

	search.topicRestore = function(topicData) {
		reIndexTids([topicData.tid]);
	};

	search.topicEdit = function(topicData) {
		search.topicSave(topicData);
	};

	search.topicDelete = function(topicData) {
		var tid = topicData.tid;
		async.parallel({
			topic: function(next) {
				db.searchRemove('topic', [tid], next);
			},
			mainPid: function(next) {
				topics.getTopicField(tid, 'mainPid', function(err, mainPid) {
					if (err) {
						return next(err);
					}
					db.searchRemove('post', [mainPid], next);
				});
			},
			posts: function(next) {
				batch.processSortedSet('tid:' + tid + ':posts', function(pids, next) {
					db.searchRemove('post', pids, next);
				}, {
					batch: batchSize
				}, next);
			}
		}, function(err, results) {
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

	search.reindex = function(callback) {
		topicsProcessed = 0;
		postsProcessed = 0;

		db.getObjectFields('global', ['topicCount', 'postCount'], function(err, data) {
			if (err) {
				return callback(err);
			}
			topicCount = data.topicCount;
			postCount = data.postCount;

			async.parallel([
				function (next) {
					reIndexTopics(next);
				},
				function (next) {
					reIndexPosts(next);
				}
			], function(err) {
				callback(err);
			});
		});
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
			], function(err) {
				if (err) {
					return next(err);
				}
				topicsProcessed += tids.length;
				next();
			});
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

		db.searchIndex('topic', data, tids, callback);
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
				}
			], function(err) {
				if (err) {
					return next(err);
				}
				postsProcessed += pids.length;
				next();
			});
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

		db.searchIndex('post', data, pids, callback);
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
		async.parallel({
			data: function(next) {
				db.getObject('nodebb-plugin-dbsearch', next);
			},
			global: function(next) {
				db.getObjectFields('global', ['topicCount', 'postCount'], next);
			}
		}, function(err, results) {
			if (err) {
				return next(err);
			}

			if (!results.data) {
				results.data = {
					topicLimit: defaultTopicLimit,
					postLimit: defaultPostLimit
				};
			}
			results.data.topicCount = results.global.topicCount;
			results.data.postCount = results.global.postCount;
			results.data.csrf = req.csrfToken();
			res.render('admin/plugins/dbsearch', results.data);
		});
	}

	function save(req, res, next) {
		if (utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
			var data = {
				postLimit: req.body.postLimit,
				topicLimit: req.body.topicLimit
			};

			db.setObject('nodebb-plugin-dbsearch', data, function(err) {
				if (err) {
					return res.json(500, 'error-saving');
				}

				postLimit = data.postLimit;
				topicLimit = data.topicLimit;

				res.json('Settings saved!');
			});
		}
	}

	socketAdmin.plugins.dbsearch = {};
	socketAdmin.plugins.dbsearch.checkProgress = function(socket, data, callback) {
		var topicsPercent = topicCount ? (topicsProcessed / topicCount) * 100 : 0;
		var postsPercent = postCount ? (postsProcessed / postCount) * 100 : 0;
		var checkProgress = {
			topicsPercent: Math.min(100, topicsPercent.toFixed(2)),
			postsPercent: Math.min(100, postsPercent.toFixed(2)),
			topicsProcessed: topicsPercent >= 100 ? topicCount : topicsProcessed,
			postsProcessed: postsPercent >= 100 ? postCount : postsProcessed
		};
		callback(null, checkProgress);
	};

	socketAdmin.plugins.dbsearch.reindex = function(socket, data, callback) {
		search.reindex(function(err) {
			if (err) {
				return callback(err);
			}

			topicsProcessed = topicCount;
			postsProcessed = postCount;
			var data = {postsIndexed: postCount, topicsIndexed: topicCount};
			db.setObject('nodebb-plugin-dbsearch', data);
			callback(null, data);
		});
	};

	socketAdmin.plugins.dbsearch.clearIndex = function(socket, data, callback) {
		topicsProcessed = 0;
		postsProcessed = 0;

		db.getObjectFields('global', ['topicCount', 'postCount'], function(err, data) {
			if (err) {
				return callback(err);
			}
			topicCount = data.topicCount;
			postCount = data.postCount;

			async.parallel([
				function (next) {
					clearSet('topics:tid', 'topic', next);
				},
				function (next) {
					clearSet('posts:pid', 'post', next);
				}
			], function(err) {
				if (err) {
					return callback(err);
				}
				db.setObject('nodebb-plugin-dbsearch', {postsIndexed: 0, topicsIndexed: 0});
				callback();
			});
		});
	};

	function clearSet(set, key, callback) {
		batch.processSortedSet(set, function(ids, next) {
			db.searchRemove(key, ids, function(err) {
				if (err) {
					return next(err);
				}
				if (key === 'topic') {
					topicsProcessed += ids.length;
				} else if (key === 'post') {
					postsProcessed += ids.length;
				}
				next();
			});
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

}(module.exports));

