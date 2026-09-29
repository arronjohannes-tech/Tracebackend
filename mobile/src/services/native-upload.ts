import { createUploadTask, FileSystemUploadType, FileSystemSessionType } from "expo-file-system/legacy";
export async function uploadFile(url: string, fileUri: string, headers: Record<string,string>) {
 const task = createUploadTask(url, fileUri, {
  httpMethod: "PUT", uploadType: FileSystemUploadType.BINARY_CONTENT,
  sessionType: FileSystemSessionType.BACKGROUND, headers
 });
 const result = await task.uploadAsync();
 if (!result) throw new Error("Upload was cancelled.");
 return {ok: result.status >= 200 && result.status < 300, status: result.status};
}
