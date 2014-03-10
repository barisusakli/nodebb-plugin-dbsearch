<h1>DB Search</h1>

<form class="form">
	<div class="row">
		<div class="col-sm-4 col-xs-12">
			<div class="form-group">
				<label>Topic Limit</label>
				<input id="topicLimit" type="text" class="form-control" placeholder="Number of topics to return" value="{topicLimit}">
				<label>Post Limit</label>
				<input id="postLimit" type="text" class="form-control" placeholder="Number of posts to return" value="{postLimit}">
			</div>
		</div>
	</div>
</form>


<button class="btn btn-primary" id="save">Save</button>
<button class="btn btn-warning" id="reindex">Re Index</button>

<script type="text/javascript">

	$('#save').on('click', function() {

		$.post('/api/admin/plugins/dbsearch/save', {
			_csrf : $('#csrf_token').val(),
			topicLimit: $('#topicLimit').val(),
			postLimit : $('#postLimit').val()
		}, function(data) {
			if(typeof data === 'string') {
				app.alertSuccess('Settings saved');
			}
		});

		return false;
	});


	$('#reindex').on('click', function() {

		app.alert({
			type: 'info',
			title: 'Reindexing',
			message: 'Reindexing content, this may take a while',
			timeout: 2000
		});

		$.post('/api/admin/plugins/dbsearch/reindex', {_csrf : $('#csrf_token').val()}, function(data) {
			if(typeof data === 'string') {
				app.alertSuccess(data);
			}
		});

		return false;
	});

</script>