---
id: pairDriverFixTemplate
title: "Pair driver fix prompt template"
scope: pair
stage: driver-fix
kind: template
---
Original user prompt:
{{prompt}}

Your previous artifact:
{{driverArtifact}}

Navigator review:
{{navigatorReview}}

Apply the review and emit the final artifact now.
