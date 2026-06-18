import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Component, ComponentProps } from "svelte";
import type { HTMLAttributes } from "svelte/elements";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

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
