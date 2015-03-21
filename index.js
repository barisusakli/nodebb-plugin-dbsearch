'use strict';

var winston = require('winston'),
	async = require('async'),
	db = module.parent.require('./database'),
	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),
	utils = module.parent.require('../public/src/utils'),
	socketPlugins = module.parent.require('./socket.io/plugins');

(function(search) {
	var defaultPostLimit = 50,
		defaultTopicLimit = 50,
		postLimit = defaultPostLimit,
		topicLimit = defaultTopicLimit;

	var topicCount = 0,
		topicsIndexed = 0;

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
		if (!postData || !postData.pid) {
			return callback();
		}
		var data = {};
		if (postData.content) {
			data.content = postData.content;
		}
		if (postData.cid) {
			data.cid = postData.cid;
		}
		if (postData.uid) {
			data.uid = postData.uid;
		}
		if (!Object.keys(data).length) {
			return;
		}

		db.searchIndex('post', data, postData.pid, callback);
	};

	search.postRestore = function(postData) {
		search.postSave(postData);
	};

	search.postEdit = function(postData) {
		search.postSave(postData);
	};

	search.postDelete = function(pid, callback) {
		db.searchRemove('post', pid, callback);
	};

	search.postMove = function(data) {
		search.reIndexPid(data.post.pid);
	};

	search.topicSave = function(topicData, callback) {
		callback = callback || function() {};

		if (!topicData || !topicData.tid) {
			return callback();
		}
		var data = {};
		if (topicData.title) {
			data.content = topicData.title;
		}
		if (topicData.cid) {
			data.cid = topicData.cid;
		}
		if (topicData.uid) {
			data.uid = topicData.uid;
		}
		if (!Object.keys(data).length) {
			return;
		}

		db.searchIndex('topic', data, topicData.tid, callback);
	};

	search.topicRestore = function(topicData) {
		search.reIndexTopic(topicData.tid);
	};

	search.topicEdit = function(topicData) {
		search.topicSave(topicData);
	};

	search.topicDelete = function(tid, callback) {
		db.searchRemove('topic', tid, function(err) {
			if (err) {
				return callback(err);
			}

			topics.getPids(tid, function(err, pids) {
				if (err) {
					return callback(err);
				}

				async.eachLimit(pids, 50, search.postDelete, callback);
			});
		});
	};

	search.topicMove = function(data) {
		search.reindexTopic(data.tid);
	};

	search.searchQuery = function(data, callback) {
		if (!data || !data.index) {
			return callback(null, []);
		}
		var limit = data.index === 'post' ? postLimit : topicLimit;
		var query = {};
		if (data.cid) {
			query.cid = data.cid;
		}
		if (data.uid) {
			query.uid = data.uid;
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
		topicsIndexed = 0;
		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}
			topicCount = tids.length;
			async.eachLimit(tids, 20, function(tid, next) {
				search.reIndexTopic(tid, function(err) {
					if (err) {
						return next(err);
					}
					++topicsIndexed;
					next();
				});
			}, callback);
		});
	};

	search.clearIndex = function(callback) {
		topicsIndexed = 0;

		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}
			topicCount = tids.length;
			async.eachLimit(tids, 50, function(tid, next) {
				search.topicDelete(tid, function(err) {
					if (err) {
						return next(err);
					}
					++topicsIndexed;
					next();
				});
			}, callback);
		});
	};

	search.reIndexTopic = function(tid, callback) {
		async.parallel([
			function (next) {
				search.reIndexTopicData(tid, next);
			},
			function (next) {
				topics.getPids(tid, function(err, pids) {
					if (err) {
						return next(err);
					}

					search.reIndexPids(pids, next);
				});
			}
		], callback);
	};

	search.reIndexTopicData = function(tid, callback) {
		callback = callback || function() {};
		if (!tid) {
			return callback(new Error('invalid-tid'));
		}
		var topicData;
		async.waterfall([
			function(next) {
				topics.getTopicFields(tid, ['title', 'uid', 'cid'], next);
			},
			function(_topicData, next) {
				topicData = _topicData;
				db.searchRemove('topic', tid, next);
			},
			function(next) {
				topicData.tid = tid;
				search.topicSave(topicData, next);
			}
		], callback);
	};

	search.reIndexPids = function(pids, callback) {
		async.eachLimit(pids, 20, search.reIndexPid, callback);
	};

	search.reIndexPid = function(pid, callback) {
		var post;
		async.waterfall([
			function(next) {
				posts.getPostFields(pid, ['content', 'uid', 'tid'], next);
			},
			function(_post, next) {
				post = _post;
				topics.getTopicField(_post.tid, 'cid', next);
			},
			function(cid, next) {
				post.cid = cid;
				db.searchRemove('post', pid, next);
			},
			function(next) {
				search.postSave(post, next);
			}
		], callback);
	};

	function renderAdmin(req, res, next) {
		db.getObject('nodebb-plugin-dbsearch', function(err, data) {
			if (err) {
				return next(err);
			}

			if (!data) {
				data = {
					topicLimit: defaultTopicLimit,
					postLimit: defaultPostLimit
				};
			}
			data.csrf = req.csrfToken();
			res.render('admin/plugins/dbsearch', data);
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

	socketPlugins.dbsearch = {};
	socketPlugins.dbsearch.checkProgress = function(socket, data, callback) {
		if (!parseInt(topicCount, 10)) {
			return callback(null, 100);
		}
		callback(null, Math.min(100, ((topicsIndexed / topicCount) * 100).toFixed(2)));
	};

	socketPlugins.dbsearch.reindex = function(socket, data, callback) {
		search.reindex(callback);
	};

	socketPlugins.dbsearch.clearIndex = function(socket, data, callback) {
		search.clearIndex(callback);
	};

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

