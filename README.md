# Student Leader Office Hours Kiosk

A web-based **check-in kiosk and admin dashboard** built to track student leader office hours in a simple, secure, and scalable way. This project was designed for real-world use in a student government office and deployed as a live website.

The system supports a locked-down **public kiosk mode** for check-ins and a separate **password-protected admin dashboard** for managing sessions and viewing data.

---

## ✨ Features

### Kiosk Mode

* Public-facing check-in page
* Password-gated kiosk access
* Designed for tablet / shared-device use
* Auto session handling (open/close logic)
* Prevents unauthorized access to admin tools

### Admin Dashboard

* Secure admin authentication
* View and manage office hour sessions
* Firestore-backed data persistence
* Clean separation from kiosk UI

### General

* Fully deployed web app
* Uses environment variables for security
* Modular React component structure

---

## 🛠 Tech Stack

* **Frontend:** React + Vite
* **Backend / DB:** Firebase Firestore
* **Hosting:** Firebase Hosting
* **Auth:** Password-based gating (admin & kiosk)

---

## 🔐 Authentication & Security Overview

Security was a core design consideration for this project because it is intended for use on **shared, public-facing devices**.

Key security decisions include:

* **Separation of concerns:** the public kiosk and admin dashboard are isolated so kiosk users can never navigate into admin functionality
* **Password-gated kiosk access** to prevent misuse when the device is unattended
* **Protected admin dashboard** with no public routing exposure
* **Environment variables** used for Firebase configuration to avoid leaking credentials
* **Firestore access patterns** designed around least-privilege usage

This mirrors how real-world office kiosks and check-in systems are secured, balancing usability with protection against accidental or malicious access.

---

## 💡 Why I Built This

I built this project to solve a real operational problem: tracking student leader office hours in a way that is **simple for users**, **secure for administrators**, and **cheap to deploy**.

Many existing solutions were either too complex, required paid software, or were not designed for shared devices. I wanted to design something that felt realistic to how kiosks are actually used in offices, where security cannot rely on trusting the user.

This project allowed me to:

* Design a system for **untrusted, public input**
* Practice applying **security boundaries** in a frontend-heavy application
* Build and deploy a tool that could realistically be used in a professional setting

It reflects my interest in building practical systems that sit at the intersection of **web development, security, and real-world constraints**.

---

## 💡 Design Goals

* Simple UI for non-technical users
* Clear separation between public and admin functionality
* Low-cost deployment (no paid backend services)
* Easy to extend for future features



