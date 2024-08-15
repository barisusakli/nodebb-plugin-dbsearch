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
			bootbox.confirm('모든 콘텐츠를 다시 색인화하시겠습니까? 콘텐츠의 양에 따라 시간이 소요됩니다. 포럼 속도가 느려질 수 있습니다.', function (confirm) {
				if (!confirm) {
					return;
				}
				socket.emit('admin.plugins.dbsearch.reindex', function (err) {
					if (err) {
						alerts.error(err);
						return clearProgress();
					}
					alerts.success('콘텐츠 색인을 시작했습니다! 시간이 소요됩니다. 이 페이지에서 진행 상황을 확인할 수 있습니다.');
					startProgress();
				});
			});

			return false;
		});

		$('#clear-index').on('click', function () {
			bootbox.confirm('모든 색인을 지우시겠습니까? 콘텐츠의 양에 따라 시간이 소요됩니다. 포럼 속도가 느려질 수 있습니다.', function (confirm) {
				if (!confirm) {
					return;
				}
				socket.emit('admin.plugins.dbsearch.clearIndex', function (err) {
					if (err) {
						alerts.error(err);
						return clearProgress();
					}
					alerts.success('인덱스 지우기가 시작되었습니다! 시간이 소요됩니다. 진행 상황을 확인할 수 있습니다.');
					startProgress();
				});
			});
			return false;
		});

		$('#changeLanguage').on('click', function () {
			var lang = $('#indexLanguage').val();
			alerts.success('"' + lang + '"로 색인 대상 언어를 변경합니다.');
			socket.emit('admin.plugins.dbsearch.changeLanguage', lang, function (err) {
				if (err) {
					return alerts.error(err);
				}
				alerts.success('검색 색인 언어가 변경되었습니다!');
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
