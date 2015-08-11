_ = lodash;
Apps = new Mongo.Collection('apps');
if (Meteor.isClient) {
  Meteor.startup(function(){
    Meteor.setInterval(function(){
      Meteor.call('getApps',function(err,result){
        Session.set('apps',result);
      });
    },1000);
  });
  Template.apps.helpers({
    result: function(){
      return Session.get('apps');
    }
  });
}

if (Meteor.isServer) {
  var CurrentApps = [];
  var CFClient = Meteor.npmRequire('cloudfoundry-client');
  var WebhookURL = 'https://hooks.slack.com/services/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'
  var SlackClient = Meteor.npmRequire('slack-notify')(WebhookURL);

  function transformResult(input){
    return _.map(input, function(i) {
      return {
        _id: i.metadata.guid,
        entity: i.entity
      }})
  }

  function compare(apps, apiResponse) {
    parsedApiResponse = transformResult(apiResponse);
    var diff = [];
    _.forEach(parsedApiResponse,function(i){
      if (!_.find(apps,function(app){
        return app._id === i._id && app.entity.state === i.entity.state;
      })) {
        diff.push(i);
      }
    });

    return _.filter(parsedApiResponse,function(i){
      return _.find(diff,{_id:i._id});
    });

  }

  Meteor.startup(function () {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

    var cfClient = new CFClient({
      host: "api.10.244.0.34.xip.io",
      protocol: "https",
      email: "admin",
      password: "admin"
    });
    Meteor.setInterval(function(){
      var response = Async.runSync(function(done) {
        cfClient.apps.get(function(err, apps) {
          done(err, apps);
        });
      });
      CurrentApps = Apps.find().fetch();
      var different = compare(CurrentApps, response.result)
      _.forEach(different,function(app){
        Apps.update({_id:app._id},{
          _id: app._id,
          entity: app.entity
        },{upsert:true});

        //notify
        if (app.entity.state === "STOPPED") {
          // console.log("slack", app.entity.name)
          SlackClient.send({
            channel: '#buildpack-webhook',
            text: app.entity.name + ' has stopped running!'
          });
        }
      });
    },1000);
  });
  Meteor.methods({
    'getApps': function() {
      return CurrentApps;
    },
  })
}

