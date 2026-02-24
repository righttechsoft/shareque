import nodemailer from "nodemailer";
import { config } from "../config";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user
    ? { user: config.smtp.user, pass: config.smtp.pass }
    : undefined,
});

export async function sendInviteEmail(
  to: string,
  name: string,
  inviteUrl: string
): Promise<void> {
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: "You've been invited to Shareque",
    html: `
      <h2>Welcome to Shareque, ${escapeHtml(name)}!</h2>
      <p>You've been invited to join Shareque. Click the link below to set your password and configure 2FA:</p>
      <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
      <p>This link expires in 48 hours.</p>
    `,
  });
}

export async function sendUploadNotification(
  to: string,
  viewUrl: string,
  password: string
): Promise<void> {
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: "Someone uploaded data to your request",
    html: `
      <h2>Upload Received</h2>
      <p>Someone has uploaded data to your upload request.</p>
      <p><strong>View link:</strong> <a href="${escapeHtml(viewUrl)}">${escapeHtml(viewUrl)}</a></p>
      <p><strong>Password:</strong> <code>${escapeHtml(password)}</code></p>
      <p>Use the password above when prompted on the view page.</p>
    `,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
