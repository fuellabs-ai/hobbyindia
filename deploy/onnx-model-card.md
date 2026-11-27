---
license: apache-2.0
base_model: harims95/hobbylm-embed-140m
library_name: onnx
pipeline_tag: feature-extraction
tags:
- onnx
- onnxruntime-web
- sentence-embeddings
- mixture-of-experts
---

# HobbyLM-Embed 140M: ONNX (fp32)

An fp32 ONNX export of [harims95/hobbylm-embed-140m](https://huggingface.co/harims95/hobbylm-embed-140m) at revision
`ea708cee107818fa0c1871eebd26d82a1e3fb1aa`, for running fully in the browser with onnxruntime-web.
All credit for the model goes to its authors; this repo only converts it. Same licence: Apache-2.0.

It powers private mode in [HobbyIndia](https://github.com/fuellabs-ai/hobbyindia), an independent guide by
Fuel Labs that points people to the right official Indian government page. Not a government website.

## Model
- 140M parameters in total, **36M active per token (excluding embeddings)**: 12 layers, hidden size 512, a mixture of
  experts with 32 experts and 8 used per token (layers 1-11), 512-dimensional L2-normalized embeddings.
- File: `hobbylm_embed_140m.fp32.onnx` (560 MB). Inputs `input_ids`, `attention_mask` (int64). Output `embedding`.
- Use the original tokenizer and prompts: prefix `"query: "` for questions and `"passage: "` for documents.

## Tested (27 Nov 2026)
| Check | Result |
|---|---|
| Cosine vs the Python model (query and document modes, single and padded batch) | **1.000000** |
| Top-card agreement with the Python model, 20 test questions | **20/20** |
| HobbyIndia private mode vs the Python server, 60 questions | **60/60** same top card |
| Browser speed, onnxruntime-web WASM, 4 threads, Apple M4 Mac (Chrome) | **128 ms** per question (median) |

int8 and fp16 versions were tried and did not meet the 0.999 cosine bar, so only fp32 is published.
Phones were not tested; at 560 MB this file is meant for laptops and desktops.
