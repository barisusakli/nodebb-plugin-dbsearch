<div class="row">
	<div class="col-lg-12">
		<div class="panel panel-default">

			<div class="panel-heading">DB Search</div>

			<div class="panel-body">

				<div class="alert alert-info">
				Total Topics: <strong>{topicCount}</strong> Topics Indexed: <strong id="topics-indexed">{topicsIndexed}</strong>
				</div>
				<div class="progress">
					<div class="topic-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="min-width: 2em;">0%</div>
				</div>

				<div class="alert alert-info">
				Total Posts: <strong>{postCount}</strong> Posts Indexed: <strong id="posts-indexed">{postsIndexed}</strong>
				</div>
				<div class="progress">
					<div class="post-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="min-width: 2em;">0%</div>
				</div>

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
				<button class="btn btn-danger" id="clear-index">Clear Index</button>

				<input id="csrf_token" type="hidden" value="{csrf}" />
			</div>
		</div>
	</div>
</div>