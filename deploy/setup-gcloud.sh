#!/usr/bin/env bash
#
# First-time setup for Google Cloud project.
# Run once per project to create Artifact Registry, Secret Manager entries,
# and Cloud Build triggers for stage/prod.
#
# Usage:  ./deploy/setup-gcloud.sh <PROJECT_ID>
#
set -euo pipefail

PROJECT_ID="${1:?Usage: setup-gcloud.sh <PROJECT_ID>}"
REGION="europe-north1"
REPO="ul-online"
SERVICE="ul-online"

echo "==> Setting project to ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

# Enable required APIs
echo "==> Enabling APIs..."
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# Create Artifact Registry repository
echo "==> Creating Artifact Registry repo..."
gcloud artifacts repositories describe "${REPO}" \
  --location="${REGION}" --format="value(name)" 2>/dev/null \
  || gcloud artifacts repositories create "${REPO}" \
       --repository-format=docker \
       --location="${REGION}" \
       --description="UL Online container images"

# Create secrets (you'll populate these manually)
for SECRET in TRAFIKLAB_SWEDEN3_RT_KEY TRAFIKLAB_SWEDEN3_STATIC_KEY TRAFIKVERKET_OPEN_DATA_API_KEY; do
  gcloud secrets describe "${SECRET}" --format="value(name)" 2>/dev/null \
    || gcloud secrets create "${SECRET}" --replication-policy="automatic"
  echo "   Secret ${SECRET} exists. Set its value with:"
  echo "   echo -n 'YOUR_KEY' | gcloud secrets versions add ${SECRET} --data-file=-"
done

# Grant Cloud Build permission to deploy to Cloud Run & read secrets
echo "==> Granting IAM roles to Cloud Build service account..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet

# Also grant the Cloud Run service account access to secrets
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Populate secrets:"
echo "     echo -n 'key' | gcloud secrets versions add TRAFIKLAB_SWEDEN3_RT_KEY --data-file=-"
echo "     echo -n 'key' | gcloud secrets versions add TRAFIKLAB_SWEDEN3_STATIC_KEY --data-file=-"
echo "     echo -n 'key' | gcloud secrets versions add TRAFIKVERKET_OPEN_DATA_API_KEY --data-file=-"
echo ""
echo "  2. Deploy staging:"
echo "     gcloud builds submit --config=cloudbuild.yaml --substitutions=_ENV=stage"
echo ""
echo "  3. Deploy production:"
echo "     gcloud builds submit --config=cloudbuild.yaml --substitutions=_ENV=prod,_MIN_INSTANCES=1,_MAX_INSTANCES=5"
echo ""
echo "  4. Trigger GTFS import on staging:"
echo "     curl -X POST https://${SERVICE}-stage-<hash>.${REGION}.run.app/api/import"
