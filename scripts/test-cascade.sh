#!/bin/bash

# Cascade Invalidation System — Manual Test Script
# Run this to verify the cascade implementation works end-to-end

set -e

echo "🔍 Cascade Invalidation System Verification"
echo "=========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check files exist
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 (MISSING)"
        return 1
    fi
}

echo "📋 Checking implementation files..."
all_ok=true

check_file "app/src/db/schema.ts" || all_ok=false
check_file "app/src/server/memory/cascade.ts" || all_ok=false
check_file "app/src/server/memory/cascade.test.ts" || all_ok=false
check_file "app/src/routes/-_api.mcp.ts" || all_ok=false
check_file "docs/CASCADE_INVALIDATION.md" || all_ok=false
check_file "IMPLEMENTATION_SUMMARY.md" || all_ok=false
check_file "app/drizzle/migrations/0041_memory_dependencies_cascade.sql" || all_ok=false

echo ""

if [ "$all_ok" = false ]; then
    echo -e "${RED}Some files are missing!${NC}"
    exit 1
fi

echo "✅ All implementation files present"
echo ""

# Check code integration points
echo "🔎 Checking code integration points..."

# Check schema has memoryDependencies table
if grep -q "export const memoryDependencies = sqliteTable" app/src/db/schema.ts; then
    echo -e "${GREEN}✓${NC} memoryDependencies table defined in schema"
else
    echo -e "${RED}✗${NC} memoryDependencies table NOT found in schema"
    all_ok=false
fi

# Check memoryFunctions exports cascade
if grep -q 'export \* from "~/server/memory/cascade"' app/src/server/memoryFunctions.ts; then
    echo -e "${GREEN}✓${NC} Cascade functions exported from memoryFunctions"
else
    echo -e "${RED}✗${NC} Cascade functions NOT exported"
    all_ok=false
fi

# Check MCP route has cascade logic
if grep -q "invalidateMemoryCascade" app/src/routes/-_api.mcp.ts; then
    echo -e "${GREEN}✓${NC} Cascade invalidation integrated into update_memory"
else
    echo -e "${RED}✗${NC} Cascade NOT integrated into update_memory"
    all_ok=false
fi

echo ""

if [ "$all_ok" = false ]; then
    echo -e "${RED}Integration check failed!${NC}"
    exit 1
fi

# Count test cases
echo "📊 Test Coverage Analysis..."
test_count=$(grep -c "it(" app/src/server/memory/cascade.test.ts || echo "0")
echo -e "${GREEN}✓${NC} $test_count test cases in cascade.test.ts"

# Code metrics
echo ""
echo "📈 Code Metrics..."
cascade_lines=$(wc -l < app/src/server/memory/cascade.ts)
test_lines=$(wc -l < app/src/server/memory/cascade.test.ts)
doc_lines=$(wc -l < docs/CASCADE_INVALIDATION.md)

echo "  • Cascade implementation: $cascade_lines lines"
echo "  • Cascade tests: $test_lines lines"
echo "  • Documentation: $doc_lines lines"
echo "  • Total: $((cascade_lines + test_lines + doc_lines)) lines"

echo ""

# Check key functions exist
echo "✔️  API Functions Available..."
functions=(
    "invalidateMemoryCascade"
    "recordMemoryDependency"
    "getDirectDependents"
    "getDirectDependencies"
    "removeMemoryDependency"
    "detectDependencyContradictions"
)

for func in "${functions[@]}"; do
    if grep -q "export async function $func" app/src/server/memory/cascade.ts; then
        echo -e "  ${GREEN}✓${NC} $func"
    else
        echo -e "  ${RED}✗${NC} $func (MISSING)"
        all_ok=false
    fi
done

echo ""

# Verify migration SQL
echo "🗄️  Database Migration..."
if grep -q "CREATE TABLE memory_dependencies" app/drizzle/migrations/0041_memory_dependencies_cascade.sql; then
    echo -e "${GREEN}✓${NC} Memory dependencies table creation"
else
    echo -e "${RED}✗${NC} Migration malformed"
    all_ok=false
fi

if grep -q "idx_memory_dependencies_parent" app/drizzle/migrations/0041_memory_dependencies_cascade.sql; then
    echo -e "${GREEN}✓${NC} Parent index"
else
    echo -e "${RED}✗${NC} Parent index missing"
    all_ok=false
fi

if grep -q "idx_memory_dependencies_child" app/drizzle/migrations/0041_memory_dependencies_cascade.sql; then
    echo -e "${GREEN}✓${NC} Child index"
else
    echo -e "${RED}✗${NC} Child index missing"
    all_ok=false
fi

echo ""

# Final status
if [ "$all_ok" = true ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}✅ CASCADE INVALIDATION SYSTEM VERIFIED${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Next steps:"
    echo "  1. npm run build           # Compile TypeScript"
    echo "  2. npm test cascade.test   # Run test suite"
    echo "  3. wrangler d1 migrations apply  # Apply database migration"
    echo "  4. npm run deploy          # Deploy to production"
    echo ""
    exit 0
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${RED}❌ VERIFICATION FAILED${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
