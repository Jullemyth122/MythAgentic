// Demo sites only: a sent form shows what would have been sent, and sends nothing.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const old = form.parentElement.querySelector(".demo-receipt");
  if (old) old.remove();
  const box = document.createElement("div");
  box.className = "demo-receipt";
  box.setAttribute("role", "status");
  const title = document.createElement("strong");
  title.textContent = "Request received (demo: nothing was sent anywhere).";
  const list = document.createElement("ul");
  for (const [name, value] of new FormData(form)) {
    if (!value) continue;
    const li = document.createElement("li");
    li.textContent = name + ": " + value;
    list.append(li);
  }
  box.append(title, list);
  form.after(box);
});
