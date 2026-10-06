---
name: Conversational Intelligence System
colors:
  surface: '#fbf8ff'
  surface-dim: '#d9d8ed'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f2ff'
  surface-container: '#eeecff'
  surface-container-high: '#e8e6fb'
  surface-container-highest: '#e2e0f5'
  on-surface: '#191a29'
  on-surface-variant: '#3d4a44'
  inverse-surface: '#2e2f3f'
  inverse-on-surface: '#f1efff'
  outline: '#6d7a73'
  outline-variant: '#bccac2'
  surface-tint: '#006c52'
  primary: '#006950'
  on-primary: '#ffffff'
  primary-container: '#008466'
  on-primary-container: '#f5fff8'
  inverse-primary: '#61dbb4'
  secondary: '#5c5e68'
  on-secondary: '#ffffff'
  secondary-container: '#dedfea'
  on-secondary-container: '#60626c'
  tertiary: '#5a5c5d'
  on-tertiary: '#ffffff'
  tertiary-container: '#737576'
  on-tertiary-container: '#fcfcfd'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#7ff8cf'
  primary-fixed-dim: '#61dbb4'
  on-primary-fixed: '#002117'
  on-primary-fixed-variant: '#00513d'
  secondary-fixed: '#e1e2ed'
  secondary-fixed-dim: '#c5c6d1'
  on-secondary-fixed: '#191b23'
  on-secondary-fixed-variant: '#444650'
  tertiary-fixed: '#e2e2e3'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1d'
  on-tertiary-fixed-variant: '#454748'
  background: '#fbf8ff'
  on-background: '#191a29'
  surface-variant: '#e2e0f5'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base-unit: 4px
  container-padding-desktop: 2rem
  container-padding-mobile: 1rem
  gutter: 1.5rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 2rem
---

## Brand & Style

The design system is anchored in the aesthetic of modern conversational AI: clean, functional, and intellectually sophisticated. It prioritizes clarity and utility, evoking a sense of calm reliability through a minimalist and corporate-modern lens. The interface acts as a quiet canvas for information, using generous whitespace and a restrained color palette to reduce cognitive load. 

The emotional response should be one of "effortless intelligence." Every interaction feels deliberate but light, avoiding decorative clutter in favor of structural precision. This is achieved through high-quality typography, subtle transitions, and a focus on content over container.

## Colors

This design system utilizes a palette of high-end neutrals to create a professional and focused environment.

- **Primary:** A refined "AI Green" (#10a37f) used sparingly for key actions, success states, and subtle branding accents.
- **Secondary/Surface:** Deep grays (#353740) serve as the primary text color and dark mode foundations, ensuring high legibility without the harshness of pure black.
- **Backgrounds:** Crisp whites and very light off-white greys (#f7f7f8) provide the structural layers, creating a sense of cleanliness and depth.
- **Accents:** Subtle blues are utilized for informational states or links to maintain a sophisticated tone.

Borders should be exceptionally subtle, using low-opacity neutrals to define space without creating visual noise.

## Typography

The typography system relies entirely on **Inter**, a typeface designed for maximum legibility on digital screens. 

- **Hierarchy:** We use weight (Semi-Bold to Regular) rather than excessive size variations to denote hierarchy.
- **Readability:** Body text uses a generous 1.5 to 1.6 line-height to ensure long-form responses remain approachable.
- **Tracking:** Headlines use slightly tighter letter spacing to feel more "locked-in" and authoritative, while labels use slight tracking for clarity at small sizes.

## Layout & Spacing

The design system employs a **fluid-to-fixed layout model**. Content is typically centered in a max-width container (e.g., 800px for text-heavy views) to mirror the focus of a chat interface.

- **Grid:** A standard 12-column system is used for dashboard views, but the primary interaction model relies on a vertical "stack" philosophy.
- **Responsive Behavior:** On mobile, sidebars collapse into a drawer, and horizontal padding shifts from 32px to 16px.
- **Rhythm:** All spacing is derived from a 4px base unit, ensuring consistent alignment across all components.

## Elevation & Depth

Depth is conveyed through **tonal layering** and **low-contrast outlines** rather than heavy shadows.

- **Surface Tiers:** Backgrounds use the lightest grey, while active containers or inputs use pure white to "pop" forward.
- **Borders:** Instead of shadows, use 1px borders with a hex value like `#e5e5e5`. This provides a "technical" and clean feel.
- **Hover Shadows:** When an element is interactive, apply a very soft, diffused shadow (0px 4px 12px rgba(0,0,0,0.05)) to suggest a slight lift from the surface.

## Shapes

The shape language is characterized by approachable, large radii.

- **Containers & Cards:** Use a standard `rounded-lg` (1rem/16px) to soften the professional aesthetic.
- **Buttons & Inputs:** Use a consistent 0.5rem (8px) to 0.75rem (12px) radius.
- **Pills:** All labels, tags, and "chips" must be fully rounded (pill-shaped) to distinguish them from structural elements.

## Components

### Buttons
- **Primary:** Solid `#10a37f` with white text. Transition background-color on hover to a slightly deeper shade.
- **Ghost/Secondary:** Subtle grey border and text. On hover, apply a light grey background shift.
- **Interaction:** All buttons should have a `200ms ease-in-out` transition.

### Input Fields
- **Architecture:** Large, pill-like or rounded containers with 1px borders.
- **Focus State:** On focus, the border color shifts to the primary green or a soft blue, with no heavy glow.

### Labels & Chips
- **Style:** Always pill-shaped. Use low-saturation background tints (e.g., a very light green for success) with higher-contrast text.

### Hover Animations
- **The "Lift":** Cards and primary items should translate -2px on the Y-axis when hovered.
- **Soft Shift:** Backgrounds for list items should transition from transparent to `#f7f7f8` smoothly.
- **Smoothness:** Avoid snappy transitions; use `cubic-bezier(0.4, 0, 0.2, 1)` for all motion to imply sophistication.

### Message Bubbles / Cards
- Maintain a clean profile with no borders for the main content area, using only subtle background color shifts to differentiate "user" and "system" roles.