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
  var StoppedApps = [];
  var CFClient = Meteor.npmRequire('cloudfoundry-client');
  var WebhookURL = 'https://hooks.slack.com/services/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'
  var SlackClient = Meteor.npmRequire('slack-notify')(WebhookURL);

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

      CurrentApps = response.result;
      _.forEach(response.result,function(item){
        Apps.update({_id:item.metadata.guid},{
          _id: item.metadata.guid,
          entity: item.entity
        },{upsert:true});
      });
      var stopped = _.filter(CurrentApps,function(i){
        return i.entity.state == 'STOPPED' && !_.find(StoppedApps,function(sp){
          return sp.entity.name == i.entity.name;
        });
      });
      StoppedApps = _.union(StoppedApps,stopped);
      _.forEach(stopped,function(i){
        SlackClient.send({
          channel: '#buildpack-webhook',
          text: i.entity.name + ' has stopped running!'
        });
      });
    },1000);
  });
  Meteor.methods({
    'getApps': function() {
      return CurrentApps;
    },
    'notify': function(message){
    }
  })
}

