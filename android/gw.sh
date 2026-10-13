#!/usr/bin/env bash
# Gradle with caches on I: (C: is nearly full). Run from Git Bash in this folder:
#   source ../keys/segundo-keystore.env && bash gw.sh :app:assembleRelease
export GRADLE_USER_HOME=/i/dev-cache/gradle-home
export ANDROID_USER_HOME=/i/dev-cache/android-user
exec /i/dev-cache/gradle-dists/gradle-8.14.3/bin/gradle --console=plain "$@"
