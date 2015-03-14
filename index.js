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

	db.getObject('nodebb-plugin-dbsearch', function(err, data) {
		if (err) {
			return winston.error(err.error);
		}

		if (data) {
			postLimit = data.postLimit ? data.postLimit : defaultPostLimit;
			topicLimit = data.topicLimit ? data.topicLimit : defaultTopicLimit;
		}
	});

	search.init = function(params, callback) {
		params.router.get('/admin/plugins/dbsearch', params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
		params.router.get('/api/admin/plugins/dbsearch', params.middleware.applyCSRF, renderAdmin);

		params.router.post('/api/admin/plugins/dbsearch/save', params.middleware.applyCSRF, save);
		callback();
	};

	search.postSave = function (postData) {
		if (postData && postData.pid && postData.content) {
			db.searchIndex('post', postData.content, postData.pid);
		}
	};

	search.postRestore = function (postData) {
		search.postSave(postData);
	};

	search.postEdit = function (postData) {
		search.postSave(postData);
	};

	search.postDelete = function (pid, callback) {
		db.searchRemove('post', pid, callback);
	};

	search.topicSave = function(topicData) {
		if (topicData && topicData.tid && topicData.title) {
			db.searchIndex('topic', topicData.title, topicData.tid);
		}
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

	search.searchQuery = function(data, callback) {
		if (data && data.index && data.query) {
			var limit = data.index === 'post' ? postLimit : topicLimit;
			db.search(data.index, data.query, limit, callback);
		} else {
			callback(null, []);
		}
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
				search.reIndexTopicTitle(tid, next);
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

	search.reIndexTopicTitle = function(tid, callback) {
		callback = callback || function() {};
		if (!tid) {
			return callback(new Error('invalid-tid'));
		}
		topics.getTopicField(tid, 'title', function(err, title) {
			if (err) {
				return callback(err);
			}
			db.searchRemove('topic', tid, function(err) {
				if (err) {
					return callback(err);
				}

				if (title) {
					return db.searchIndex('topic', title, tid, callback);
				}

				callback();
			});
		});
	};

	search.reIndexPids = function(pids, callback) {
		async.eachLimit(pids, 20, search.reIndexPid, callback);
	};

	search.reIndexPid = function(pid, callback) {
		posts.getPostField(pid, 'content', function(err, content) {
			if (err) {
				return callback(err);
			}

			db.searchRemove('post', pid, function() {
				if (content) {
					return db.searchIndex('post', content, pid, callback);
				}
				callback();
			});
		});
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

