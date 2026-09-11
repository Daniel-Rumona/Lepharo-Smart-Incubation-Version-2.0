# Guide Me

Reusable Driver.js walkthrough infrastructure for the application.

## 1. Install Driver.js

```bash
npm install driver.js
```

## 2. Mount the provider once

Wrap the authenticated application/layout:

```tsx
import { GuideProvider } from '@/components/guide-me'

<GuideProvider>
  <AppRoutes />
</GuideProvider>
```

## 3. Add the launcher

Desktop/topbar:

```tsx
import { GuideLauncher } from '@/components/guide-me'

<GuideLauncher />
```

Mobile FAB:

```tsx
<GuideLauncher mode="fab" />
```

The launcher renders nothing when the current page has no registered guides.

## 4. Register guides on a page

Use `useMemo` so the registration object is stable:

```tsx
import { useMemo } from 'react'
import {
  guideTarget,
  usePageGuides,
  type PageGuideRegistration
} from '@/components/guide-me'

const guideRegistration = useMemo<PageGuideRegistration>(
  () => ({
    pageId: 'intervention-assignments',
    pageTitle: 'Intervention Assignments',
    guides: [
      {
        id: 'assignments-overview',
        title: 'Quick tour',
        description: 'Understand the main controls on this page.',
        kind: 'page',
        order: 1,
        steps: [
          {
            element: guideTarget('assignment-metrics'),
            popover: {
              title: 'Assignment overview',
              description:
                'These metrics summarise the interventions currently in scope.',
              side: 'bottom',
              align: 'start'
            }
          },
          {
            element: guideTarget('assignment-filters'),
            popover: {
              title: 'Find an assignment',
              description:
                'Use these controls to narrow the assignment list.',
              side: 'bottom',
              align: 'start'
            }
          },
          {
            element: guideTarget('assign-intervention'),
            popover: {
              title: 'Assign an intervention',
              description:
                'Start a new intervention assignment from here.',
              side: 'bottom',
              align: 'end'
            }
          },
          {
            element: guideTarget('assignments-table'),
            popover: {
              title: 'Assignments',
              description:
                'Review beneficiaries, interventions, ownership and current status here.',
              side: 'top',
              align: 'start'
            }
          }
        ]
      }
    ]
  }),
  []
)

usePageGuides(guideRegistration)
```

## 5. Add targets to the page

```tsx
<div data-guide="assignment-metrics">
  ...
</div>

<div data-guide="assignment-filters">
  ...
</div>

<Button data-guide="assign-intervention">
  Assign New Intervention
</Button>

<div data-guide="assignments-table">
  <Table ... />
</div>
```

For controls that appear after a user action, Driver.js can wait for them:

```tsx
{
  element: guideTarget('assignment-modal'),
  waitForElement: 5000,
  skipMissingElement: true,
  popover: {
    title: 'Assignment details',
    description: 'Complete the assignment details in this modal.'
  }
}
```
