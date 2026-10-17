import itertools
import json
import struct
from dataclasses import dataclass

import numpy as np
import torch
import whisper
from onnx import TensorProto, numpy_helper
from onnx.checker import check_model
from onnx.helper import (
    find_min_ir_version_for,
    make_graph,
    make_model,
    make_node,
    make_opsetid,
    make_tensor_value_info,
)
from torch import nn
from whisper.model import Conv1d, LayerNorm, Linear, MultiHeadAttention, ResidualAttentionBlock


class SafetensorsFile:
    def __init__(self, path: str):
        self.path = path
        self.file = open(path, "rb")
        self.header_size = struct.unpack("Q", self.file.read(8))[0]
        self.data_section_offset = 8 + self.header_size
        header_str = self.file.read(self.header_size).decode("utf-8")
        self.json = json.loads(header_str)

    # sadly the naming conventions are different in the hf safetensors export
    def mingle_name(name: str) -> str:
        return (
            f"model.{name}".replace(".attn.", ".self_attn.")
            .replace(".cross_attn.", ".encoder_attn.")
            .replace(".key.", ".k_proj.")
            .replace(".value.", ".v_proj.")
            .replace(".query.", ".q_proj.")
            .replace(".blocks.", ".layers.")
            .replace(".token_embedding.", ".embed_tokens.")
            .replace(".positional_embedding", ".embed_positions.weight")
            .replace(".attn_ln.", ".self_attn_layer_norm.")
            .replace(".cross_attn_ln.", ".encoder_attn_layer_norm.")
            .replace(".out.", ".out_proj.")
            .replace(".mlp_ln.", ".final_layer_norm.")
            .replace(".mlp.0.", ".fc1.")
            .replace(".mlp.2.", ".fc2.")
            .replace(".ln.", ".layer_norm.")
            .replace(".ln_post.", ".layer_norm.")
        )

    def get_tensor_info(self, name: str):
        mingled_name = SafetensorsFile.mingle_name(name)
        entry = self.json[mingled_name]
        dtype_map = {"F16": TensorProto.FLOAT16}
        begin, end = entry["data_offsets"]
        return SafetensorsEntry(
            dtype=dtype_map[entry["dtype"]],
            shape=entry["shape"],
            offset=self.data_section_offset + begin,
            length=end - begin,
        )

    def get_tensor_bytes(self, name: str):
        entry = self.get_tensor_info(name)
        self.file.seek(entry.offset)
        return self.file.read(entry.length)


@dataclass
class SafetensorsEntry:
    dtype: np.dtype
    offset: int
    length: int
    shape: list[int]


class OnnxModelBuilder:
    def __init__(
        self,
        model: whisper.Whisper,
        safetensors_file: SafetensorsFile,
        use_ms_attn=True,
        use_diy_attn=False,
    ):
        self.inputs = []
        self.nodes = []
        self.initializers = []
        self.outputs = []
        self.value_infos = []

        self.model = model
        self.safetensors_file = safetensors_file
        self.use_ms_attn = use_ms_attn
        self.use_diy_attn = use_diy_attn

    def save(self, name: str):
        graph = make_graph(
            self.nodes,
            name,
            self.inputs,
            self.outputs,
            self.initializers,
            value_info=self.value_infos,
        )
        onnx_model = make_model(graph)
        del onnx_model.opset_import[:]
        onnx_model.opset_import.append(make_opsetid("", 20 if self.use_ms_attn else 24))
        if self.use_ms_attn:
            onnx_model.opset_import.append(make_opsetid("com.microsoft", 1))
        onnx_model.ir_version = find_min_ir_version_for(onnx_model.opset_import[:1])
        check_model(onnx_model)
        with open(f"{name}.onnx", "wb") as f:
            f.write(onnx_model.SerializeToString())
        return onnx_model

    def make_initializer_with_external_data(
        name: str, dtype: int, shape: list[int], path: str, offset: int, length: int
    ):
        tp = TensorProto()
        tp.name = name
        tp.dims.extend(shape)
        tp.data_type = dtype
        tp.data_location = TensorProto.EXTERNAL
        entry = tp.external_data.add()
        entry.key = "location"
        entry.value = path
        entry = tp.external_data.add()
        entry.key = "offset"
        entry.value = str(offset)
        entry = tp.external_data.add()
        entry.key = "length"
        entry.value = str(length)
        return tp

    def initializer(self, name: str, ref):
        if isinstance(ref, torch.Tensor):
            for pytorch_name, v in self.model.state_dict().items():
                if v.untyped_storage().data_ptr() == ref.untyped_storage().data_ptr():
                    break
            else:
                raise KeyError(f"could not find initializer pytorch name for {name}")

            # sadly somehow the data is stored in a transposed way in the safetensors file
            # this finds the right way to transpose it
            buf = self.safetensors_file.get_tensor_bytes(pytorch_name)
            ref_np = ref.detach().numpy()
            for perm in itertools.permutations(list(range(len(ref_np.shape)))):
                initial_shape = [
                    ref_np.shape[perm.index(axis)] for axis in range(len(ref_np.shape))
                ]
                ours = np.frombuffer(buf, dtype=np.float16).reshape(initial_shape).transpose(perm)
                if np.allclose(ours, ref_np):
                    break
            else:
                raise Exception("colud not find permutation for array")
            print(SafetensorsFile.mingle_name(pytorch_name), perm)

            entry = self.safetensors_file.get_tensor_info(pytorch_name)
            self.initializers.append(
                OnnxModelBuilder.make_initializer_with_external_data(
                    name,
                    entry.dtype,
                    initial_shape,
                    self.safetensors_file.path,
                    entry.offset,
                    entry.length,
                )
            )

            if initial_shape != ref_np.shape:
                return self.node(f"{name}.transpose", "Transpose", [name], perm=perm)
            else:
                return name
        elif isinstance(ref, np.ndarray):
            self.initializers.append(numpy_helper.from_array(ref, name=name))
            return name
        else:
            raise TypeError(f"ref for initializer {name} is of unknown type")

    def node(
        self, name: str, type: str, inputs: list[str], outputs: list[str] | None = None, **kwargs
    ):
        if outputs is None:
            outputs = [f"{name}.out"]
        self.nodes.append(make_node(type, inputs, outputs, name=name, **kwargs))
        if len(outputs) == 1:
            outputs = outputs[0]
        return outputs

    def input(self, name: str, type: int, dims: list):
        self.inputs.append(make_tensor_value_info(name, type, dims))
        return name

    def output(self, name: str, type: int, dims: list):
        self.outputs.append(make_tensor_value_info(name, type, dims))
        return name

    def value_info(self, name: str, type: int, dims: list):
        self.value_infos.append(make_tensor_value_info(name, type, dims))
        return name

    def linear(self, name: str, ref: Linear, x: str, outputs: list = None):
        weight = self.initializer(f"{name}.weight", ref.weight.T)
        x = self.node(f"{name}.mul", "MatMul", [x, weight], outputs if ref.bias is None else None)
        if ref.bias is None:
            return x
        else:
            bias = self.initializer(f"{name}.bias", ref.bias)
            return self.node(f"{name}.add", "Add", [x, bias], outputs)

    def diy_multi_head_attention(
        self,
        name: str,
        ref: MultiHeadAttention,
        x: str,
        kv: tuple[str, str] = None,
    ):
        q = self.linear(f"{name}.query", ref.query, x)
        if kv is not None:
            [k, v] = kv
        else:
            k = self.linear(f"{name}.key", ref.key, x)
            v = self.linear(f"{name}.value", ref.value, x)

        head_size = ref.query.bias.shape[0] // ref.n_head
        reshape_dims = self.initializer(
            f"{name}.reshape_dims", np.array([0, -1, ref.n_head, head_size])
        )
        q = self.node(f"{name}.reshape_q", "Reshape", [q, reshape_dims])
        q = self.node(f"{name}.transpose_q", "Transpose", [q], perm=[0, 2, 1, 3])
        k = self.node(f"{name}.reshape_k", "Reshape", [k, reshape_dims])
        k = self.node(f"{name}.transpose_k", "Transpose", [k], perm=[0, 2, 3, 1])
        v = self.node(f"{name}.reshape_v", "Reshape", [v, reshape_dims])
        v = self.node(f"{name}.transpose_v", "Transpose", [v], perm=[0, 2, 1, 3])

        scale = self.initializer(
            f"{name}.scale", np.array([1.0 / np.sqrt(head_size)], dtype=np.float16)
        )
        q = self.node(f"{name}.scale_q", "Mul", [q, scale])

        qk = self.node(f"{name}.qk_matmul", "MatMul", [q, k], [f"{name}.attention.qk"])
        w = self.node(f"{name}.softmax", "Softmax", [qk])
        wv = self.node(f"{name}.wv_matmul", "MatMul", [w, v])
        wv = self.node(f"{name}.wv_transpose", "Transpose", [wv], perm=[0, 2, 1, 3])
        wv_reshape_dims = self.initializer(f"{name}.wv_reshape_dims", np.array([0, 0, -1]))
        wv = self.node(
            f"{name}.reshape_wv", "Reshape", [wv, wv_reshape_dims], [f"{name}.attention.wv"]
        )
        return self.linear(f"{name}.out", ref.out, wv)

    def multi_head_attention(
        self,
        name: str,
        ref: MultiHeadAttention,
        x: str,
        kv: tuple[str, str] = None,
        kv_cache=False,
        causal=True,
    ):
        if not kv_cache and not causal and self.use_diy_attn:
            return self.diy_multi_head_attention(name, ref, x, kv)

        q = self.linear(f"{name}.query", ref.query, x)
        if kv is not None:
            k, v = kv
            inputs = inputs_ms = [q, k, v]
        elif kv_cache:
            k = self.linear(f"{name}.key", ref.key, x)
            v = self.linear(f"{name}.value", ref.value, x)

            past_key = self.input(
                f"past.{name}.key",
                TensorProto.FLOAT16,
                ["self_kv_cache_width", "num_heads", "past_sequence_length", "head_size"],
            )
            past_key = self.node(
                f"{name}.past_key_gather", "Gather", [past_key, "self_kv_cache_indices"]
            )
            reshape_dims = self.initializer(
                f"{name}.append_shape", np.array([0, ref.n_head, -1, 64], dtype=np.int64)
            )
            past_key_append = self.node(f"{name}.past_key_append", "Reshape", [k, reshape_dims])
            past_key = self.node(
                f"{name}.past_key_concat", "Concat", [past_key, past_key_append], axis=2
            )
            past_value = self.input(
                f"past.{name}.value",
                TensorProto.FLOAT16,
                ["self_kv_cache_width", "num_heads", "past_sequence_length", "head_size"],
            )
            past_value = self.node(
                f"{name}.past_value_gather", "Gather", [past_value, "self_kv_cache_indices"]
            )
            past_value_append = self.node(f"{name}.past_value_append", "Reshape", [v, reshape_dims])
            past_value = self.node(
                f"{name}.past_value_concat", "Concat", [past_value, past_value_append], axis=2
            )

            inputs_ms = [
                q,
                k,
                v,
                "",
                "",
                "",
                past_key,
                past_value,
                self.self_kv_cache_lengths_maybe_int32,
            ]
            inputs = [q, k, v, "", past_key, past_value, self.self_kv_cache_lengths_maybe_int32]
        else:
            k = self.linear(f"{name}.key", ref.key, x)
            v = self.linear(f"{name}.value", ref.value, x)
            inputs = inputs_ms = [q, k, v]

        if self.use_ms_attn:
            # we dont use the default Attention block from the main ONNX domain here, because it does not have
            # a WebGPU shader yet. See docs at:
            #  https://github.com/microsoft/onnxruntime/blob/rel-1.28.0/docs/ContribOperators.md#commicrosoftmultiheadattention
            wv, present_key, present_value, qk = self.node(
                f"{name}.attention",
                "MultiHeadAttention",
                inputs_ms,
                [
                    f"{name}.attention.wv",
                    f"present.{name}.key",
                    f"present.{name}.value",
                    f"{name}.attention.qk",
                ],
                num_heads=ref.n_head,
                unidirectional=int(causal),
                domain="com.microsoft",
                # cache_indirection is pretty cool and what we need for buffer sharing
                # but unfortunately unsupported on webGPU as far as I (jaro) can tell on 10th Oct. 2026
            )
            self.value_info(
                qk,
                TensorProto.FLOAT16,
                ["batch_size", 20, "seq_len", "dims" if kv else "total_seq_len"],
            )  # this is needed as otherwise the shape inference fails (stupid onnxruntime)
        else:
            wv, present_key, present_value, qk = self.node(
                f"{name}.attention",
                "Attention",
                inputs,
                [
                    f"{name}.attention.wv",
                    f"present.{name}.key",
                    f"present.{name}.value",
                    f"{name}.attention.qk",
                ],
                q_num_heads=ref.n_head,
                kv_num_heads=ref.n_head,
                is_causal=int(causal),
            )

        if kv_cache:
            self.output(
                present_key,
                TensorProto.FLOAT16,
                ["batch_size", "num_heads", "sequence_length", "head_size"],
            )
            self.output(
                present_value,
                TensorProto.FLOAT16,
                ["batch_size", "num_heads", "sequence_length", "head_size"],
            )
        out = self.linear(f"{name}.out", ref.out, wv)
        return out

    def layer_norm(self, name: str, ref: LayerNorm, x: str):
        # whisper does the LayerNorms in fp32 even if all other calculations are fp16
        weight = self.initializer(f"{name}.weight", ref.weight)
        weight = self.node(f"{name}.weight_cast", "Cast", [weight], to=TensorProto.FLOAT)
        bias = self.initializer(f"{name}.bias", ref.bias)
        bias = self.node(f"{name}.bias_cast", "Cast", [bias], to=TensorProto.FLOAT)
        x = self.node(f"{name}.input_cast", "Cast", [x], to=TensorProto.FLOAT)
        x = self.node(name, "LayerNormalization", [x, weight, bias])
        x = self.node(f"{name}.output_cast", "Cast", [x], to=TensorProto.FLOAT16)
        return x

    def conv(self, name: str, ref: Conv1d, x: str, **kwargs):
        weight = self.initializer(f"{name}.weight", ref.weight)
        bias = self.initializer(f"{name}.bias", ref.bias)
        return self.node(name, "Conv", [x, weight, bias], **kwargs)

    def mlp(self, name: str, ref: tuple[Linear, nn.GELU, Linear], x: str):
        x = self.linear(f"{name}.linear_in", ref[0], x)
        x = self.node(f"{name}.gelu", "Gelu", [x])
        return self.linear(f"{name}.linear_out", ref[2], x)

    def residual_attention_block(
        self,
        name: str,
        ref: ResidualAttentionBlock,
        x: str,
        cross_kv: tuple[str, str] = None,
        kv_cache=True,
        self_attn_causal=True,
    ):
        after_ln = self.layer_norm(f"{name}.attn_ln", ref.attn_ln, x)
        after_attn = self.multi_head_attention(
            f"{name}.attn",
            ref.attn,
            after_ln,
            None,
            kv_cache,
            causal=self_attn_causal,
        )
        x = self.node(f"{name}.add_attn", "Add", [x, after_attn])
        if ref.cross_attn:
            after_cross_ln = self.layer_norm(f"{name}.cross_attn_ln", ref.cross_attn_ln, x)
            after_cross_attn = self.multi_head_attention(
                f"{name}.cross_attn", ref.cross_attn, after_cross_ln, cross_kv, causal=False
            )
            x = self.node(f"{name}.add_cross_attn", "Add", [x, after_cross_attn])
        after_mlp_ln = self.layer_norm(f"{name}.mlp_ln", ref.mlp_ln, x)
        after_mlp = self.mlp(f"{name}.mlp", ref.mlp, after_mlp_ln)
        return self.node(f"{name}.add_mlp", "Add", [x, after_mlp])


def create_cross_kv_prefill_model(b: OnnxModelBuilder) -> OnnxModelBuilder:
    xa = b.input("encoder_hidden_states", TensorProto.FLOAT, ["batch_size", 1500, 1280])
    xa = b.node("xa_cast", "Cast", [xa], to=TensorProto.FLOAT16)

    for i, block in enumerate(b.model.decoder.blocks):
        k = b.linear(f"block.{i}.cross_attn.key", block.cross_attn.key, xa, [f"cross_attn.{i}.key"])
        b.output(k, TensorProto.FLOAT16, ["batch_size", 1500, 1280])
        v = b.linear(
            f"block.{i}.cross_attn.value", block.cross_attn.value, xa, [f"cross_attn.{i}.value"]
        )
        b.output(v, TensorProto.FLOAT16, ["batch_size", 1500, 1280])
    return b


def create_decoder(b: OnnxModelBuilder) -> OnnxModelBuilder:
    x = b.input("input_ids", TensorProto.INT64, ["input_seq_storage_size", "seq_len"])
    seq_len = b.node("seq_len", "Shape", [x], start=1)

    # to be used in the attention blocks (dont want to plumb it through)
    indices = b.input("self_kv_cache_indices", TensorProto.INT64, ["batch_size"])
    self_kv_cache_lengths = b.input(
        "self_kv_cache_lengths", TensorProto.INT64, ["batch_size"]
    )  # this is before reindexing through self_kv_cache_indices
    self_kv_cache_lengths = b.node(
        "self_kv_cache_lengths_gather", "Gather", [self_kv_cache_lengths, indices]
    )
    if b.use_ms_attn:
        # for stupid reasons the ms attention wants the kv cache lengths as int32
        b.self_kv_cache_lengths_maybe_int32 = b.node(
            "self_kv_cache_lengths_cast", "Cast", [self_kv_cache_lengths], to=TensorProto.INT32
        )  # [batch_size]
    else:
        b.self_kv_cache_lengths_maybe_int32 = self_kv_cache_lengths

    token_embedding = b.initializer(
        "token_embedding", b.model.decoder.token_embedding.weight
    )  # [51866, 1280]
    x = b.node("embed_tokens", "Gather", [token_embedding, x])  # [batch_size, sequence_len, 1280]

    positional_embedding = b.initializer(
        "positional_embedding", b.model.decoder.positional_embedding
    )  # [448, 1280]

    delta = b.initializer("positional_embedding_range_delta", np.array([1], dtype=np.int64))
    start = b.initializer("positional_embedding_range_start", np.array([0], dtype=np.int64))
    positional_embedding_ranges = b.node(
        "positional_embedding_range", "Range", [start, seq_len, delta]
    )  # [seq_len]

    unsqueeze_axes = b.initializer(
        "positional_embedding_range_unsqueeze_axes", np.array([0], dtype=np.int64)
    )
    positional_embedding_ranges = b.node(
        "positional_embedding_range_unsqueeze",
        "Unsqueeze",
        [positional_embedding_ranges, unsqueeze_axes],
    )  # [1, seq_len]

    unsqueeze_axes = b.initializer(
        "self_kv_cache_lengths_unsqueeze_axes", np.array([1], dtype=np.int64)
    )
    lengths = b.node(
        "self_kv_cache_lengths_unsqueeze", "Unsqueeze", [self_kv_cache_lengths, unsqueeze_axes]
    )  # [batch_size, 1]

    positional_embedding_ranges = b.node(
        "positional_embedding_range_add", "Add", [positional_embedding_ranges, lengths]
    )  # [batch_size, seq_len]

    positional_embedding = b.node(
        "positional_embedding_gather", "Gather", [positional_embedding, positional_embedding_ranges]
    )
    x = b.node("add_positional_embedding", "Add", [x, positional_embedding])

    cross_kv_cache_indices = b.input("cross_kv_cache_indices", TensorProto.INT64, ["batch_size"])

    for i, block in enumerate(b.model.decoder.blocks):
        cross_k = b.input(
            f"cross_attn.{i}.key", TensorProto.FLOAT16, ["cross_kv_cache_size", 1500, 1280]
        )
        cross_k = b.node(
            f"block.{i}.cross_kv_cache_gather_k", "Gather", [cross_k, cross_kv_cache_indices]
        )
        cross_v = b.input(
            f"cross_attn.{i}.value", TensorProto.FLOAT16, ["cross_kv_cache_size", 1500, 1280]
        )
        cross_v = b.node(
            f"block.{i}.cross_kv_cache_gather_v", "Gather", [cross_v, cross_kv_cache_indices]
        )
        x = b.residual_attention_block(
            f"block.{i}", block, x, [cross_k, cross_v], self_attn_causal=True
        )
    x = b.layer_norm("ln", b.model.decoder.ln, x)
    token_embedding_transposed = b.node("transpose_token_embedding", "Transpose", [token_embedding])
    x = b.node("matmul_final", "MatMul", [x, token_embedding_transposed])

    x = b.node("cast_logits", "Cast", [x], ["logits"], to=TensorProto.FLOAT)
    b.output(x, TensorProto.FLOAT, ["batch_size", "input_seq_len+1", 51866])

    alignment_heads_list = []
    for i, (block, head) in enumerate(b.model.alignment_heads.indices().numpy().T):
        block_qk = f"block.{block}.cross_attn.attention.qk"  # [batch_size, 20, seq_len, 1500]
        block_idx = b.initializer(
            f"alignment_head_{i}_gather_input", np.array([head], dtype=np.int64)
        )
        head = b.node(f"alignment_head_{i}_gather", "Gather", [block_qk, block_idx], axis=1)
        alignment_heads_list.append(head)
    alignment_heads = b.node("alignment_heads_concat", "Concat", alignment_heads_list, axis=1)
    alignment_heads = b.node(
        "alignment_heads_cast", "Cast", [alignment_heads], ["alignment_heads"], to=TensorProto.FLOAT
    )
    b.output(
        alignment_heads, TensorProto.FLOAT, ["batch_size", len(alignment_heads_list), 1500, 1280]
    )
    return b


def create_encoder(b: OnnxModelBuilder) -> OnnxModelBuilder:
    x = b.input("input_features", TensorProto.FLOAT, ["batch_size", 128, 3000])
    x = b.node("cast_input", "Cast", [x], to=TensorProto.FLOAT16)
    x = b.conv("conv1", b.model.encoder.conv1, x, pads=[1, 1], kernel_shape=[3])
    x = b.node("gelu_after_conv1", "Gelu", [x])
    x = b.conv("conv2", b.model.encoder.conv2, x, pads=[1, 1], strides=[2], kernel_shape=[3])
    x = b.node("gelu_after_conv2", "Gelu", [x])
    x = b.node("transpose", "Transpose", [x], perm=[0, 2, 1])

    positional_embedding = b.initializer(
        "positional_embedding", b.model.encoder.positional_embedding
    )
    x = b.node("add_positional_embedding", "Add", [x, positional_embedding])

    for i, block in enumerate(b.model.encoder.blocks):
        x = b.residual_attention_block(
            f"block.{i}",
            block,
            x,
            kv_cache=False,
            self_attn_causal=False,
        )

    x = b.layer_norm("ln_post", b.model.encoder.ln_post, x)
    x = b.node("cast_logits", "Cast", [x], ["last_hidden_state"], to=TensorProto.FLOAT)
    b.output(x, TensorProto.FLOAT, ["batch_size", 1500, 1280])
    return b


if __name__ == "__main__":
    torch.set_default_dtype(torch.float16)  # make sure the weights dont get converted to f32
    model = whisper.load_model("large-v3-turbo")
    safetensors = SafetensorsFile("whisper_large_v3_turbo.safetensors")

    print("creating encoder model...")
    create_encoder(OnnxModelBuilder(model, safetensors, use_diy_attn=True, use_ms_attn=True)).save(
        "whisper_large_v3_turbo_encoder"
    )

    print("creating decoder kv cache prefill model...")
    create_cross_kv_prefill_model(OnnxModelBuilder(model, safetensors, use_ms_attn=True)).save(
        "whisper_large_v3_turbo_decoder_cross_kv_prefill"
    )

    print("creating decoder model...")
    create_decoder(OnnxModelBuilder(model, safetensors, use_ms_attn=True)).save(
        "whisper_large_v3_turbo_decoder"
    )

    print("creating decoder non_ms_attn...")
    create_decoder(OnnxModelBuilder(model, safetensors, use_ms_attn=True)).save(
        "whisper_large_v3_turbo_decoder_non_ms_attn"
    )

    print("done :)")
