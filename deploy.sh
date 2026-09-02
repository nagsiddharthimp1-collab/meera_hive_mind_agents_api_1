#!/bin/bash

set -e # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting zero-downtime deployment...${NC}"

git pull
mkdir -p ./logs

# Generate timestamp for unique container and image names
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NEW_FRONTEND_IMAGE="frontend-image:$TIMESTAMP"
NEW_FRONTEND_CONTAINER="frontend-new-$TIMESTAMP"

# Function to cleanup on failure
cleanup_on_failure() {
  echo -e "${RED}Deployment failed, cleaning up new containers and images...${NC}"
  docker stop $NEW_FRONTEND_CONTAINER 2> /dev/null || true
  docker rm $NEW_FRONTEND_CONTAINER 2> /dev/null || true
  docker rmi $NEW_FRONTEND_IMAGE 2> /dev/null || true
  exit 1
}

# Set trap to cleanup on failure
trap cleanup_on_failure ERR

echo -e "${YELLOW}Building new Docker image...${NC}"
if ! docker build -t $NEW_FRONTEND_IMAGE .; then
  echo -e "${RED}Docker image build failed! Deployment aborted.${NC}"
  exit 1
fi
echo -e "${GREEN}Docker image built successfully.${NC}"

echo -e "${YELLOW}Starting new container...${NC}"
docker run -d --name $NEW_FRONTEND_CONTAINER \
  -p 3001:3000 \
  -v $(pwd)/logs:/app/logs \
  $NEW_FRONTEND_IMAGE

echo -e "${YELLOW}Waiting for new container to be healthy...${NC}"
# Wait a bit for container to start
sleep 10

# Check if new frontend container is healthy
if ! docker exec $NEW_FRONTEND_CONTAINER curl -f http://localhost:3000/ 2> /dev/null; then
  echo -e "${RED}New frontend container health check failed!${NC}"
  cleanup_on_failure
fi

echo -e "${GREEN}New container is healthy. Switching traffic...${NC}"

# Stop old container gracefully
echo -e "${YELLOW}Stopping old container...${NC}"
docker stop frontend 2> /dev/null || true
docker rm frontend 2> /dev/null || true

# Change port mapping for new frontend container to use port 3000
docker stop $NEW_FRONTEND_CONTAINER
docker rm $NEW_FRONTEND_CONTAINER

docker run -d --name frontend \
  -p 3000:3000 \
  -v $(pwd)/logs:/app/logs \
  $NEW_FRONTEND_IMAGE

echo -e "${YELLOW}Cleaning up old containers and images...${NC}"

# Clean up old images (keep last 3 versions)
docker images frontend-image --format "table {{.Tag}}" | grep -E '^[0-9]' | sort -r | tail -n +4 | xargs -r docker rmi frontend-image: 2> /dev/null || true

echo -e "${GREEN}Zero-downtime deployment completed successfully!${NC}"
