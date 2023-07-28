'use strict';

define('admin/plugins/dbsearch', [
	'alerts', 'admin/settings',
], function (alerts, settings) {
	var dbsearch = {};
	var intervalId = 0;

	$(window).on('action:ajaxify.end', function (ev, data) {
		if (data.url === 'admin/plugins/dbsearch' && ajaxify.data.working) {
			startProgress();
		} else {
			clearProgress();
		}
	});

	dbsearch.init = function () {
		$('#save').on('click', function () {
			$.post(config.relative_path + '/api/admin/plugins/dbsearch/save', {
				_csrf: config.csrf_token,
				topicLimit: $('#topicLimit').val(),
				postLimit: $('#postLimit').val(),
				excludeCategories: $('#exclude-categories').val(),
			}, function (data) {
				if (typeof data === 'string') {
					settings.toggleSaveSuccess($('#save'));
				}
			});

			return false;
		});

		$('#reindex').on('click', function () {
			bootbox.confirm('Are you sure you want to reindex all content? This might take a while depending on the amount of content. During the operation the forum might slow down.', function (confirm) {
				if (!confirm) {
					return;
				}
				socket.emit('admin.plugins.dbsearch.reindex', function (err) {
					if (err) {
						alerts.error(err);
						return clearProgress();
					}
					alerts.success('Started indexing content! This might take a while. You can check the progress on this page.');
					startProgress();
				});
			});

			return false;
		});

		$('#clear-index').on('click', function () {
			bootbox.confirm('Are you sure you want to clear all indices? This might take a while depending on the amount of content. During the operation the forum might slow down.', function (confirm) {
				if (!confirm) {
					return;
				}
				socket.emit('admin.plugins.dbsearch.clearIndex', function (err) {
					if (err) {
						alerts.error(err);
						return clearProgress();
					}
					alerts.success('Started clearing index! This might take a while. You can check the progress on this page.');
					startProgress();
				});
			});
			return false;
		});

		$('#changeLanguage').on('click', function () {
			var lang = $('#indexLanguage').val();
			alerts.success('Changing index language to "' + lang + '".');
			socket.emit('admin.plugins.dbsearch.changeLanguage', lang, function (err) {
				if (err) {
					return alerts.error(err);
				}
				alerts.success('Search index language changed!');
			});
		});
	};

	function startProgress() {
		clearProgress();
		intervalId = setInterval(checkProgress, 1000);
	}

	function clearProgress() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = 0;
		}
	}

	function checkProgress() {
		socket.emit('admin.plugins.dbsearch.checkProgress', function (err, progress) {
			if (err) {
				clearProgress();
				return alerts.error(err);
			}

			var working = parseInt(progress.working, 10);
			if (!working) {
				clearInterval(intervalId);
				$('#reindex').removeAttr('disabled');
			} else {
				$('#reindex').attr('disabled', true);
			}

			$('#work-in-progress').toggleClass('hidden', !working);

			if (progress.topicsPercent >= 100 && progress.postsPercent >= 100) {
				progress.topicsPercent = 100;
				progress.postsPercent = 100;
			}

			$('#topics-indexed').text(progress.topicsIndexed);
			$('#posts-indexed').text(progress.postsIndexed);
			$('#messages-indexed').text(progress.messagesIndexed);
			$('.topic-progress').css('width', progress.topicsPercent + '%').text(progress.topicsPercent + '%');
			$('.post-progress').css('width', progress.postsPercent + '%').text(progress.postsPercent + '%');
			$('.message-progress').css('width', progress.messagesPercent + '%').text(progress.messagesPercent + '%');
		});
	}

	return dbsearch;
});
