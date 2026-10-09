"use server";
import { revalidatePath } from "next/cache";
import { workService } from "@/lib/server";

const service = () => workService((path) => revalidatePath(path));

// "use server" files may only export async functions, so each action is wrapped individually.
export async function saveTaskAction(input: unknown) { return service().saveTask(input); }
export async function setTaskStatusAction(input: unknown) { return service().setTaskStatus(input); }
export async function setTaskVisibilityAction(input: unknown) { return service().setTaskVisibility(input); }
export async function deleteTaskAction(input: unknown) { return service().deleteTask(input); }
export async function logTimeAction(input: unknown) { return service().logTime(input); }
export async function deleteTimeAction(input: unknown) { return service().deleteTime(input); }
export async function startUploadAction(input: unknown) { return service().startUpload(input); }
export async function finishUploadAction(input: unknown) { return service().finishUpload(input); }
export async function deleteFileAction(input: unknown) { return service().deleteFile(input); }
export async function setFileVisibilityAction(input: unknown) { return service().setFileVisibility(input); }
