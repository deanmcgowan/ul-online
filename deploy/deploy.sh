#!/usr/bin/env bash
#
# Deploy to staging or production via Cloud Build.
#
# Usage:
#   ./deploy/deploy.sh stage        # Deploy to staging (default)
#   ./deploy/deploy.sh prod         # Deploy to production
#
set -euo pipefail

ENV="${1:-stage}"
REGION="europe-north1"

case "${ENV}" in
  stage)
    echo "==> Deploying to STAGING"
    gcloud builds submit \
      --config=cloudbuild.yaml \
      --substitutions="_ENV=stage,_MIN_INSTANCES=0,_MAX_INSTANCES=2"
    ;;
  prod)
    echo "==> Deploying to PRODUCTION"
    gcloud builds submit \
      --config=cloudbuild.yaml \
      --substitutions="_ENV=prod,_MIN_INSTANCES=1,_MAX_INSTANCES=5"
    ;;
  *)
    echo "Usage: deploy.sh [stage|prod]"
    exit 1
    ;;
esac

echo ""
echo "==> Deployment to ${ENV} complete!"
echo "    Service URL:"
gcloud run services describe "ul-online-${ENV}" \
  --region="${REGION}" \
  --format="value(status.url)"
