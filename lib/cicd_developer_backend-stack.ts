import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CicdDeveloperBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    const bucket = new s3.Bucket(this, 'DevPortalBucket');

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'DevPortalTable', {
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function
    const fn = new lambda.Function(this, 'DevPortalLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require("aws-sdk");
        const { v4: uuidv4 } = require("uuid");
        const ddb = new AWS.DynamoDB.DocumentClient();
        exports.handler = async (event) => {
          const body = JSON.parse(event.body);
          const item = { requestId: uuidv4(), ...body };
          await ddb.put({ TableName: "${table.tableName}", Item: item }).promise();
          return { statusCode: 200, body: JSON.stringify(item) };
        };
      `),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    table.grantWriteData(fn);

    // API Gateway
    const api = new apigateway.LambdaRestApi(this, 'DevPortalAPI', {
      handler: fn,
      proxy: false,
    });

    const form = api.root.addResource('submit');
    form.addMethod('POST');

    // CodeCommit Repository
    const repo = new codecommit.Repository(this, 'DevPortalRepo', {
      repositoryName: 'dev-portal-repo',
    });

    // CodeBuild Project
    const buildProject = new codebuild.PipelineProject(this, 'DevPortalBuild', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });
    

    // CodePipeline
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    new codepipeline.Pipeline(this, 'DevPortalPipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'Checkout',
              repository: repo,
              output: sourceOutput,
              branch: 'master',
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Build',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.S3DeployAction({
              actionName: 'S3Deploy',
              input: buildOutput,
              bucket,
            }),
          ],
        },
      ],
    });
  }
}
    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CicdDeveloperBackendQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  

