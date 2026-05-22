#!/bin/bash
cd /root/meetgay
git add .
git commit -m "Auto-save $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main
