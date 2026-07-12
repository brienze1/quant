package remote

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
)

// rpcRequest is the body the browser shim POSTs to /rpc. It mirrors a single
// window.go.controller.<Struct>.<Method>(...args) call.
type rpcRequest struct {
	Struct string            `json:"struct"`
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

// rpcResponse mirrors a Wails method return: a result value and/or an error.
// Result has no omitempty so zero values ("", false, 0, empty slices) serialize
// faithfully over the bridge instead of collapsing to `undefined` — e.g. an empty
// terminal backlog must arrive as "" so the client renders an empty terminal, not
// a broken one.
type rpcResponse struct {
	Result interface{} `json:"result"`
	Error  string      `json:"error,omitempty"`
}

var (
	errorType = reflect.TypeOf((*error)(nil)).Elem()
	ctxType   = reflect.TypeOf((*context.Context)(nil)).Elem()
)

// dispatchableParam reports whether a parameter type can be safely populated
// from JSON sent by a remote client. It rejects context.Context (so lifecycle
// hooks like OnStartup/OnShutdown and any ctx-taking method can't be invoked
// with an injected nil context), as well as channels and funcs.
func dispatchableParam(t reflect.Type) bool {
	if t == ctxType {
		return false
	}
	switch t.Kind() {
	case reflect.Chan, reflect.Func:
		return false
	}
	return true
}

// dispatcher invokes methods on the bound controllers by name — exactly what
// the Wails runtime does over its native bridge, but over HTTP for remote
// browser clients. Controllers are keyed by the same struct names the frontend
// uses (e.g. "sessionController"), so no per-method wiring is needed.
type dispatcher struct {
	controllers map[string]reflect.Value
}

func newDispatcher(controllers map[string]interface{}) *dispatcher {
	m := make(map[string]reflect.Value, len(controllers))
	for name, ctrl := range controllers {
		m[name] = reflect.ValueOf(ctrl)
	}
	return &dispatcher{controllers: m}
}

func (d *dispatcher) dispatch(req rpcRequest) rpcResponse {
	ctrl, ok := d.controllers[req.Struct]
	if !ok {
		return rpcResponse{Error: fmt.Sprintf("unknown controller: %q", req.Struct)}
	}
	method := ctrl.MethodByName(req.Method)
	if !method.IsValid() {
		return rpcResponse{Error: fmt.Sprintf("unknown method: %s.%s", req.Struct, req.Method)}
	}

	mt := method.Type()
	if mt.IsVariadic() {
		return rpcResponse{Error: fmt.Sprintf("%s.%s is not remotely callable (variadic)", req.Struct, req.Method)}
	}
	if len(req.Args) != mt.NumIn() {
		return rpcResponse{Error: fmt.Sprintf("%s.%s expects %d args, got %d", req.Struct, req.Method, mt.NumIn(), len(req.Args))}
	}

	in := make([]reflect.Value, mt.NumIn())
	for i := 0; i < mt.NumIn(); i++ {
		if !dispatchableParam(mt.In(i)) {
			return rpcResponse{Error: fmt.Sprintf("%s.%s is not remotely callable", req.Struct, req.Method)}
		}
		argPtr := reflect.New(mt.In(i))
		if err := json.Unmarshal(req.Args[i], argPtr.Interface()); err != nil {
			return rpcResponse{Error: fmt.Sprintf("arg %d (%s): %v", i, mt.In(i), err)}
		}
		in[i] = argPtr.Elem()
	}

	return marshalReturn(method.Call(in))
}

// marshalReturn maps Go's (result, error) / (result) / (error) / () return
// shapes onto the rpcResponse the shim expects.
func marshalReturn(out []reflect.Value) rpcResponse {
	var resp rpcResponse
	for _, v := range out {
		if v.Type().Implements(errorType) {
			if !v.IsNil() {
				resp.Error = v.Interface().(error).Error()
			}
			continue
		}
		resp.Result = v.Interface()
	}
	return resp
}
