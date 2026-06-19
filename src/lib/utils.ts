import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Component, ComponentProps } from "svelte";
import type { HTMLAttributes } from "svelte/elements";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Shared focus-glow ring used by every input-like control (text fields, selects,
// date pickers, comboboxes, buttons, checkboxes, switches) so the visual treatment
// stays in one place instead of being hand-copied per component.
export const focusRingClass =
	"focus-visible:border-ring focus-visible:ring-[var(--primary-soft)] focus-visible:ring-3";
// Compensates for browsers never firing :focus-visible on a mouse-clicked button —
// apply to triggers that have a bits-ui-style data-state=open/closed attribute.
export const focusRingOpenClass =
	"data-[state=open]:border-ring data-[state=open]:ring-[var(--primary-soft)] data-[state=open]:ring-3";

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithChild<
	T,
	TChild extends Component | keyof HTMLElementTagNameMap | null = null
> = T & {
	child?: TChild extends null
		? never
		: Component<
				TChild extends keyof HTMLElementTagNameMap
					? HTMLAttributes<HTMLElementTagNameMap[TChild] & EventTarget>
					: TChild extends Component
						? ComponentProps<TChild>
						: never
			>;
};
