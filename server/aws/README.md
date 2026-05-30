# AWS deployment (cost-optimized)

Deploys the Fairy-Stockfish engine to **App Runner** and the public static site to **S3 + CloudFront**.

## Estimated monthly cost (us-east-1)

| Component | ~Cost |
|-----------|-------|
| App Runner 0.5 vCPU, autoscale 1–3 | **~$15–25** |
| CloudFront + S3 (static) | **$1–3** |
| WAF (optional, on by default) | **~$6** |
| ECR storage (few images) | **< $1** |
| **Total** | **~$7–18/mo** (credits apply) |

Cloudflare Worker (API proxy) remains free tier or **$5/mo** paid plan.

## Deploy

### Engine (App Runner)

```bash
export ALERT_EMAIL="you@example.com"   # SNS alarms (5xx, traffic, scale-out)
chmod +x server/aws/deploy.sh scripts/engine-observability.sh
./server/aws/deploy.sh

# Logs + dashboard
./scripts/engine-observability.sh
# https://us-east-1.console.aws.amazon.com/cloudwatch/home#dashboards:name=chess-border-engine-engine
```

### Static site (S3 + CloudFront) - once

```bash
chmod +x server/aws/deploy-static.sh
./server/aws/deploy-static.sh
# Add ACM + site CNAMEs in Cloudflare (see docs/DOMAIN.md)
./web/scripts/sync-s3-static.sh
```

### API worker + full release

```bash
./server/worker/deploy.sh
# Or everything:
./scripts/deploy-site.sh
```

## Update after code changes

```bash
./server/aws/deploy.sh                  # engine image
./web/scripts/sync-s3-static.sh         # web / landing / pieces
./server/worker/deploy.sh               # API worker
```

## Rotate API key

```bash
./scripts/rotate-api-key.sh
```

No iPhone/web rebuild required. See [SECURITY.md](../../SECURITY.md).

## Billing alarm (optional, us-east-1 only)

```bash
aws cloudformation deploy \
  --stack-name chess-border-billing \
  --template-file server/aws/monitoring.yaml \
  --parameter-overrides AlertEmail=you@example.com MonthlyBudgetUsd=25 \
  --region us-east-1
```

Confirm the SNS subscription email after deploy.

## Tear down

```bash
aws s3 rm s3://borderchess-static-$(aws sts get-caller-identity --query Account --output text) --recursive
aws cloudformation delete-stack --stack-name chess-border-static --region us-east-1
aws cloudformation delete-stack --stack-name chess-border-engine --region us-east-1
aws ecr delete-repository --repository-name chess-border-engine --force --region us-east-1
```

## Stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name chess-border-engine \
  --query "Stacks[0].Outputs" \
  --region us-east-1
```
