# Stale Memory Banner Feature

## Overview

The Stale Memory Banner is a context maintenance tool built into Locker's memories dashboard. It helps users identify and review memories that haven't been accessed in a long time (90+ days).

## Features

### 1. Automatic Detection
- **Threshold**: 90 days
- **Calculation**: `STALE_MEMORY_MS = 90 * 24 * 60 * 60 * 1000` milliseconds
- **Logic**: Memories with `Date.now() - timestamp > STALE_MEMORY_MS` are marked as stale
- **Singular/Plural**: Correctly displays "1 memory" vs "N memories"

### 2. Banner Widget
Located directly above the memory card list in `/routes/memories.tsx` (lines 2149-2156).

#### Design
- **Background**: Amber warning style (`bg-amber-500/10`)
- **Border**: Amber border (`border-amber-500/25`)
- **Icon**: Warning triangle SVG in amber (`text-amber-500`)
- **Message**: "You have X memories older than 90 days — consider reviewing them."
- **Animation**: Fade-in and slide-in from top (duration: 200ms)

#### Components
- **Filter Button**: Clickable main message area that activates stale-only view
- **Dismiss Button**: X button (title: "Dismiss for 7 days")

### 3. Dismissal System
- **localStorage Key**: `locker-stale-banner-dismissed-at`
- **TTL**: 7 days (`STALE_BANNER_DISMISS_TTL_MS`)
- **Behavior**: Stores timestamp when dismissed, checking if `Date.now() - storedTs < TTL_MS`
- **Persistence**: Survives page refreshes; auto-reappears after 7 days

### 4. Filter Activation
When the user clicks the banner message:
1. Sets `staleFilterActive` to `true`
2. Clears category filters
3. Clears search query
4. Sets sort to "oldest" for chronological review
5. Displays filtered list with stale memories only

**Clear Filter Button** (lines 2159-2172) allows users to exit the stale view.

## Constants

All constants are defined at the top of `memories.tsx`:

```typescript
const STALE_MEMORY_DAYS = 90;
const STALE_MEMORY_MS = STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000;
const STALE_BANNER_DISMISS_KEY = "locker-stale-banner-dismissed-at";
const STALE_BANNER_DISMISS_TTL_DAYS = 7;
const STALE_BANNER_DISMISS_TTL_MS = STALE_BANNER_DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
```

## Implementation Details

### Hook: `useStaleMemoryBanner`
- Manages banner visibility state
- Reads dismissal timestamp from localStorage
- Respects 7-day TTL
- Provides `visible` and `dismiss` return values

### Component: `StaleMemoryBanner`
- Renders the amber warning banner
- Accepts `staleCount`, `onFilter`, and `onDismiss` props
- Fully accessible with proper button semantics
- Responsive layout with flexbox

### Calculation: `staleCount`
Computed in Dashboard using `useMemo`:
```typescript
const staleCount = useMemo(
  () => memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS).length,
  [memories]
);
```

## Testing

Comprehensive test suite in `src/routes/memories.test.tsx` (32 tests, all passing):

### Test Categories
1. **Constants** - Verify all thresholds and keys are correct
2. **Hook Logic** - Banner visibility, dismissal, TTL expiration
3. **Stale Detection** - Count accuracy for various time ranges
4. **Banner Component** - Rendering, messaging, interactions
5. **localStorage TTL** - Persistence and expiration behavior
6. **Edge Cases** - Boundary conditions and large counts
7. **Dismissal Persistence** - TTL renewal on subsequent dismissals

### Running Tests
```bash
npm test -- src/routes/memories.test.tsx
```

## User Experience Flow

1. **Initial Load**: Dashboard loads memories
2. **Banner Check**: If stale memories exist AND not dismissed in last 7 days → banner appears
3. **User Options**:
   - Click message → activate stale filter → review old memories
   - Click X → dismiss banner for 7 days
   - Ignore → banner stays visible
4. **After 7 Days**: Dismissal expires, banner reappears if stale memories still exist

## UX Details

### When Banner Appears
- Only when `staleCount > 0`
- Only if dismissal has expired or never was set
- Animated entrance (fade + slide-in)
- Appears above search/filter controls but below any alerts

### Visibility Rules
- Hidden during data loading (`isLoading`)
- Hidden when active filter is "stale" (already viewing stale content)
- Hidden if no stale memories exist

## Integration Points

1. **Memory Creation**: Timestamp is set automatically in database
2. **Memory Display**: No special UI needed; standard cards work fine
3. **Filtering**: Stale filter is a special mode that overrides other filters
4. **Export**: Stale memories can be exported like any other memory

## Browser Compatibility

- Requires localStorage support (all modern browsers)
- Uses ES6 syntax (classes, arrow functions)
- CSS uses Tailwind utility classes
- React 18+ hooks

## Performance

- `useMemo` prevents unnecessary recalculations
- Stale count recalculates only when memories array changes
- localStorage operations are synchronous but minimal
- Banner component is simple and rerenders efficiently
