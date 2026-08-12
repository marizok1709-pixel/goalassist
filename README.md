# Goal Assist

Goal Assist is a deadline-driven execution system that turns large goals into concrete daily work.

You give it a **deadline**, your **materials**, and what needs to be completed. Goal Assist breaks the workload down, calculates the pace required to finish on time, and tells you honestly whether you're on track.

## Try it

**[Launch Goal Assist](https://goalassist.vercel.app/onboarding)**

## Why I built it

I originally built Goal Assist because of my own German exam preparation.
Having an exam a year away sounded manageable, but the actual question was much harder.
I started designing a system for myself that would take a distant goal and turn it into daily actions. After showing it to a colleague, I realized the same problem existed outside my own preparation.

So I turned the system into a web app.

## How it works

Goal Assist is built around a simple execution loop:

**Mission → Materials → Progress Units → Daily Pace → Reality Check**

## The MVP

The goal of v0.1 is deliberately narrow:

**Validate the execution loop and get the first real users.**

The MVP currently includes:

* Mission creation
* Hard deadlines
* Material tracking
* Automatic workload slicing
* Progress Units
* Required daily pace calculation
* Reality Engine
* Daily task generation
* Calendar-based planning
* Dashboard for active missions
* ICS calendar export

The product is still an MVP. Some parts are rough, and feedback is more valuable than polish right now.

## Tech Stack

### Frontend

* **Next.js 16**
* **Tailwind CSS v4**

### Backend

* **FastAPI**
* Python

### Deployment

* **Vercel** 

## Project Structure

```text
goal-assist/
├── backend/       # FastAPI backend
└── frontend/      # Next.js 16 + Tailwind CSS v4 frontend
```

## What I'm trying to learn

Goal Assist is also an experiment in building a product around a real problem rather than just building another demo.


## Feedback

If you try Goal Assist, I'd genuinely like to hear what worked, what didn't, and where the system broke down.

**Reach me at [markmitrofanov.de@gmail.com]

