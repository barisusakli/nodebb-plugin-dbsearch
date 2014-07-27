'use strict';

var winston = require('winston'),
	async = require('async'),
	db = module.parent.require('./database'),
	topics = module.parent.require('./topics'),
	posts = module.parent.require('./posts'),
	utils = module.parent.require('./../public/src/utils');


(function(search) {
	var defaultPostLimit = 50,
		defaultTopicLimit = 50,
		postLimit = defaultPostLimit,
		topicLimit = defaultTopicLimit;

	db.getObject('nodebb-plugin-dbsearch', function(err, data) {
		if (err) {
			return winston.error(err.error);
		}

		if (data) {
			postLimit = data.postLimit ? data.postLimit : defaultPostLimit;
			topicLimit = data.topicLimit ? data.topicLimit : defaultTopicLimit;
		}
	});

	search.init = function(app, middleware, controllers, callback) {
		app.get('/admin/plugins/dbsearch', middleware.admin.buildHeader, renderAdmin);
		app.get('/api/admin/plugins/dbsearch', renderAdmin);

		app.post('/api/admin/plugins/dbsearch/reindex', reindex);
		app.post('/api/admin/plugins/dbsearch/save', save);
		callback();
	};

	search.postSave = function (postData) {
		if(postData && postData.pid && postData.content) {
			db.searchIndex('post', postData.content, postData.pid);
		}
	};

	search.postDelete = function (pid) {
		if (pid) {
			db.searchRemove('post', pid);
		}
	};

	search.postRestore = function (postData) {
		search.postSave(postData);
	};

	search.postEdit = function (postData) {
		search.postSave(postData);
	};

	search.topicSave = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.topicDelete = function(tid) {
		db.searchRemove('topic', tid);
		topics.getPids(tid, function(err, pids) {
			if (!err) {
				for(var i=0; i<pids.length; ++i) {
					search.postDelete(pids[i]);
				}
			}
		});
	};

	search.topicRestore = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.topicEdit = function(tid) {
		search.reIndexTopicTitle(tid);
	};

	search.searchQuery = function(data, callback) {
		if(data && data.index && data.query) {
			var limit = data.index === 'post' ? postLimit : topicLimit;
			db.search(data.index, data.query, limit, callback);
		} else {
			callback(null, []);
		}
	};

	search.reindex = function(callback) {
		db.getSortedSetRange('topics:tid', 0, -1, function(err, tids) {
			if (err) {
				return callback(err);
			}

			async.eachLimit(tids, 10, search.reIndexTopic, callback);
		});
	};

	search.reIndexTopic = function(tid, callback) {
		winston.info('reindexing tid', tid);
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

			db.searchRemove('topic', tid, function() {
				if (title) {
					return db.searchIndex('topic', title, tid, callback);
				}

				callback();
			});
		});
	};

	search.reIndexPids = function(pids, callback) {
		async.eachLimit(pids, 10, search.reIndexPid, callback);
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

			res.render('admin/plugins/dbsearch', data);
		});
	}

	function reindex(req, res, next) {
		var start = process.hrtime();
		search.reindex(function(err) {
			if(err) {
				return res.json(500, 'failed to reindex');
			}
			process.profile('reindex' , start);
			res.json('Content reindexed');
		});
	}

	function save(req, res, next) {
		if(utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
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

