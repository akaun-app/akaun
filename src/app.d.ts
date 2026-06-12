declare global {
	namespace App {
		interface Locals {
			user: { id: number; username: string; role: string } | null;
		}
	}
}

export {};
