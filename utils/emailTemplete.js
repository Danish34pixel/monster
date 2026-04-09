export const emailTemplate = ({ username, resetLink }) => {
  return `
    <div>
      <h1>Hello ${username}</h1>
      <p>Click here to reset your password - <a href="${resetLink}">Reset link</a></p>
    </div>
    `;
};
