/**
 * Purely decorative, period-accurate Windows 95 error boxes for the title-bar
 * window buttons. Nothing here touches app data.
 */
export interface FakeError {
  title: string;
  message: string;
  detail?: string;
}

export const FAKE_ERRORS: FakeError[] = [
  {
    title: "TASKBOARD",
    message: "This program has performed an illegal operation and will be shut down.",
    detail: "If the problem persists, contact the program vendor.",
  },
  {
    title: "General Protection Fault",
    message: "TASKBOARD caused a general protection fault in module KRNL386.EXE at 0002:043F.",
    detail: "Choose OK to close the application.",
  },
  {
    title: "Windows",
    message: "A fatal exception 0E has occurred at 0028:C0011E36.",
    detail: "The current application will be terminated. Press any key to continue.",
  },
  {
    title: "Error",
    message: "Cannot find file WINSOCK.DLL (or one of its components).",
    detail: "Check to ensure the path and filename are correct.",
  },
  {
    title: "Out of Memory",
    message: "Not enough memory to complete this operation.",
    detail: "Quit one or more programs, and then try again.",
  },
  {
    title: "Mouse",
    message: "Keyboard not found. Press F1 to continue.",
  },
];

export function randomFakeError(): FakeError {
  return FAKE_ERRORS[Math.floor(Math.random() * FAKE_ERRORS.length)];
}
