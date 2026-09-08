/**
 * JSX namespace shim — @types/react@18.x moved `JSX` from a global namespace
 * into the React namespace. We re-export it as a global here so that component
 * return types can keep using the familiar `JSX.Element` shape without
 * importing React in every file.
 *
 * This file has no runtime effect (it is types-only) but is picked up
 * because it sits in `include` and is imported once from main.tsx.
 */

import type { JSX as ReactJSX } from 'react';

declare global {

  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>;
  }
}

export {};